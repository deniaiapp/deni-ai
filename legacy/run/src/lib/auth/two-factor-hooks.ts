import "@tanstack/react-start/server-only";

import { getExtracted } from "@/i18n/server";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import type { GenericEndpointContext } from "better-auth";
import { assertRateLimit, RateLimitError } from "../billing/rate-limit";
import { emailOtpAvailable, twoFactorMethodOf } from "./two-factor-delivery";

const TWO_FACTOR_COOKIE_NAME = "two_factor";

type TwoFactorUser = {
  id: string;
  twoFactorEnabled?: boolean | null;
  twoFactorMethod?: string | null;
};

function badRequest(message: string) {
  return new APIError("BAD_REQUEST", { message });
}

async function countPasskeys(ctx: GenericEndpointContext, userId: string) {
  return ctx.context.adapter.count({ model: "passkey", where: [{ field: "userId", value: userId }] });
}

// A passkey stands in for both factors only when the authenticator checked the person with a
// fingerprint, face, or PIN; a bare security-key touch proves only possession.
export async function requireUserVerified(userVerified: boolean) {
  if (!userVerified) {
    const t = await getExtracted();
    throw badRequest(t("Unlock the passkey with your fingerprint, face, or screen lock PIN and try again."));
  }
}

// Passkeys sign in on their own, so they work only for accounts that chose them. A leftover
// passkey on an authenticator or email account cannot skip that account's second factor.
export async function assertPasskeySignInAllowed(ctx: GenericEndpointContext, credentialId: string) {
  const passkey = await ctx.context.adapter.findOne<{ userId: string }>({
    model: "passkey",
    where: [{ field: "credentialID", value: credentialId }],
  });
  const user = passkey
    ? ((await ctx.context.internalAdapter.findUserById(passkey.userId)) as TwoFactorUser | null)
    : null;
  if (!user?.twoFactorEnabled || twoFactorMethodOf(user) !== "passkey") {
    const t = await getExtracted();
    throw badRequest(t("This account does not use a passkey. Sign in with Google or GitHub."));
  }
}

// Better Auth sends a code to any two-factor user once sendOTP is configured. Codes go only to
// users who chose email, so an authenticator user cannot be downgraded to a weaker channel,
// and each user can request a few codes per window.
export const twoFactorBefore = createAuthMiddleware(async (ctx) => {
  if (ctx.path === "/two-factor/enable") {
    const session = await getSessionFromCtx(ctx);
    if (!session) return;
    // method "otp" turns two-factor on before a code ever arrives; email codes are enabled by
    // the first verified code instead, from the setup screen.
    if (ctx.body?.method === "otp" || session.user.twoFactorEnabled) {
      const t = await getExtracted();
      throw badRequest(t("Turn off two-factor authentication before choosing another method."));
    }
    await ctx.context.internalAdapter.updateUser(session.user.id, { twoFactorMethod: "totp" });
    return;
  }

  if (ctx.path === "/passkey/generate-register-options" || ctx.path === "/passkey/verify-registration") {
    const session = await getSessionFromCtx(ctx);
    if (!session) return;
    const user = session.user as TwoFactorUser;
    if (user.twoFactorEnabled && twoFactorMethodOf(user) !== "passkey") {
      const t = await getExtracted();
      throw badRequest(t("Turn off two-factor authentication before choosing another method."));
    }
    return;
  }

  if (ctx.path === "/passkey/delete-passkey") {
    const session = await getSessionFromCtx(ctx);
    if (!session) return;
    const user = session.user as TwoFactorUser;
    if (user.twoFactorEnabled && twoFactorMethodOf(user) === "passkey" && (await countPasskeys(ctx, user.id)) <= 1) {
      const t = await getExtracted();
      throw badRequest(t("Add another passkey before removing your last one."));
    }
    return;
  }

  if (ctx.path !== "/two-factor/send-otp") return;
  let user: TwoFactorUser | null = null;
  const session = await getSessionFromCtx(ctx);
  if (session) {
    user = session.user as TwoFactorUser;
  } else {
    const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
    const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
    const challenge = identifier
      ? await ctx.context.internalAdapter.findVerificationValue(identifier)
      : null;
    // Without a challenge the plugin rejects the request itself.
    if (!challenge) return;
    user = (await ctx.context.internalAdapter.findUserById(challenge.value)) as TwoFactorUser | null;
  }
  if (!user) return;
  if (twoFactorMethodOf(user) !== "email") {
    const t = await getExtracted();
    throw badRequest(t("This account does not use email codes."));
  }
  if (!emailOtpAvailable()) {
    const t = await getExtracted();
    throw badRequest(t("Codes by email are not available right now. Contact support."));
  }
  try {
    await assertRateLimit(user.id, "two-factor-otp", 5, 15 * 60_000);
  } catch (error) {
    if (!(error instanceof RateLimitError)) throw error;
    const t = await getExtracted();
    throw new APIError("TOO_MANY_REQUESTS", {
      message: t("Too many codes requested. Wait 15 minutes and try again."),
    });
  }
});

async function startOAuthChallenge(ctx: GenericEndpointContext) {
  const data = ctx.context.newSession;
  if (!data) return;
  if (!data.user.twoFactorEnabled) {
    throw ctx.redirect("/two-factor/setup");
  }

  deleteSessionCookie(ctx, true);
  await ctx.context.internalAdapter.deleteSession(data.session.token);
  ctx.context.setNewSession(null);

  const maxAge = 600;
  const twoFactorCookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME, { maxAge });
  const identifier = `2fa-${generateRandomString(20)}`;
  const expiresAt = new Date(Date.now() + maxAge * 1000);
  await ctx.context.internalAdapter.createVerificationValue({
    value: data.user.id,
    identifier,
    expiresAt,
  });
  await ctx.context.internalAdapter.createVerificationValue({
    value: "0",
    identifier: `2fa-attempts-${identifier}`,
    expiresAt,
  });
  await ctx.setSignedCookie(
    twoFactorCookie.name,
    identifier,
    ctx.context.secret,
    twoFactorCookie.attributes,
  );
  // The method only picks which form the page shows; the server still checks every factor.
  throw ctx.redirect(`/two-factor?method=${twoFactorMethodOf(data.user as TwoFactorUser)}`);
}

export const twoFactorAfter = createAuthMiddleware(async (ctx) => {
  if (ctx.path === "/callback/:id") return startOAuthChallenge(ctx);

  const returned = ctx.context.returned;
  if (!returned || returned instanceof Error) return;

  // The first verified passkey is the setup step for passkey two-factor.
  if (ctx.path === "/passkey/verify-registration") {
    const userId = (returned as { userId?: string }).userId;
    const user = userId
      ? ((await ctx.context.internalAdapter.findUserById(userId)) as TwoFactorUser | null)
      : null;
    if (user && !user.twoFactorEnabled) {
      await ctx.context.internalAdapter.updateUser(user.id, {
        twoFactorEnabled: true,
        twoFactorMethod: "passkey",
      });
    }
    return;
  }

  // Passkeys belong to the passkey method; switching methods removes them so none can sign in.
  if (ctx.path === "/two-factor/disable") {
    const userId = ctx.context.newSession?.user.id;
    if (userId) {
      await ctx.context.adapter.deleteMany({
        model: "passkey",
        where: [{ field: "userId", value: userId }],
      });
    }
  }
});
