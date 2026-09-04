import "server-only";

import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";

const TWO_FACTOR_COOKIE_NAME = "two_factor";

export const oauthTwoFactorAfter = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/callback/:id") return;
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
  throw ctx.redirect("/two-factor");
});
