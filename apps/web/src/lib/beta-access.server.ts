import { env } from "@/env";
import { isAdminEmail } from "@/lib/admin-emails";
import {
  BETA_ACCESS_PATH,
  BETA_ACCESS_REQUIRED_CODE,
  isBetaGatedServerPath,
  isGuestSignInPath,
  normalizeBetaEmail,
} from "@/lib/beta-access";
import type { BetaAccessStore } from "@/lib/beta-access-store";
import { isVerifiedAdmin } from "@/lib/verified-admin";

export type BetaAccessUser = {
  id: string;
  email?: string | null;
  emailVerified?: boolean;
  isAnonymous?: boolean | null;
};

/** Whether this deployment runs the private beta gate (`BETA_ACCESS_REQUIRED`). */
export function isBetaAccessRequired() {
  return env.BETA_ACCESS_REQUIRED;
}

/**
 * Whether the account pays for a plan: Go, Plus, Pro, or a team plan it belongs to
 * (a canceled plan counts until its period ends). Go through education is free, so
 * it does not count.
 */
export async function isOnPaidPlan(userId: string) {
  const { getSubscriptionTier, hasEducationGo } = await import("@/lib/usage");
  if ((await getSubscriptionTier(userId)) === "free") return false;
  return !(await hasEducationGo(userId));
}

/** Operators (`ADMIN_EMAILS` / `ADMIN_EMAIL_DOMAINS`, verified) always have access and manage testers. */
export function isBetaAdmin(user: Omit<BetaAccessUser, "id"> | null | undefined) {
  return isVerifiedAdmin(user, isAdminEmail);
}

/**
 * Granted users are remembered per process for a minute, so the gate costs no
 * query on most requests. Refusals are not cached: a grant takes effect at once;
 * a removal within a minute (immediately on the instance that removed it).
 */
const GRANT_CACHE_TTL_MS = 60_000;
const grantedUntil = new Map<string, number>();

/** Forget a cached grant (after removing it). */
export function forgetBetaAccess(userId: string) {
  grantedUntil.delete(userId);
}

async function loadStore(): Promise<BetaAccessStore> {
  return (await import("@/lib/beta-access-store")).betaAccessStore;
}

/**
 * Whether a signed-in user may use this deployment. Always true without the
 * gate. With it: never for guests; always for admins; otherwise a grant linked
 * to the user, or one for their verified email (linked to them on this first
 * match, so it follows the account if the email later changes), or, with
 * `BETA_ACCESS_PAID_PLANS`, a paid plan (checked last, so invited testers cost
 * no billing query).
 */
export async function hasBetaAccess(
  user: BetaAccessUser,
  {
    required = isBetaAccessRequired(),
    store,
    now = Date.now(),
    paidPlans = env.BETA_ACCESS_PAID_PLANS,
    isPaying = isOnPaidPlan,
  }: {
    required?: boolean;
    store?: BetaAccessStore;
    now?: number;
    /** `BETA_ACCESS_PAID_PLANS`: paying accounts get in without an invitation. */
    paidPlans?: boolean;
    isPaying?: (userId: string) => Promise<boolean>;
  } = {},
): Promise<boolean> {
  if (!required) return true;
  if (user.isAnonymous) return false;
  if (isBetaAdmin(user)) return true;
  if ((grantedUntil.get(user.id) ?? 0) > now) return true;

  const grants = store ?? (await loadStore());
  const granted =
    (await grants.hasUserGrant(user.id)) ||
    Boolean(
      user.emailVerified === true &&
      user.email &&
      (await grants.claimEmailGrant(normalizeBetaEmail(user.email), user.id)),
    ) ||
    (paidPlans === true && (await isPaying(user.id)));
  if (granted) grantedUntil.set(user.id, now + GRANT_CACHE_TTL_MS);
  else grantedUntil.delete(user.id);
  return granted;
}

/** The 403 every gated server route answers for a signed-in user without access. */
export function betaAccessDeniedResponse() {
  return Response.json(
    {
      error: BETA_ACCESS_REQUIRED_CODE,
      code: BETA_ACCESS_REQUIRED_CODE,
      message: "Deni AI v8 is in private beta, and this account has not been invited.",
    },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}

type GateSession = { user: BetaAccessUser } | null | undefined;

export type BetaAccessGateDeps = {
  required: boolean;
  getSession: (headers: Headers) => Promise<GateSession>;
  hasAccess: (user: BetaAccessUser) => Promise<boolean>;
};

function hasSessionCookie(request: Request) {
  return /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/.test(
    request.headers.get("cookie") ?? "",
  );
}

/**
 * The server-side half of the gate, run by the request middleware in
 * `src/start.ts` before any route handler: guest sign-in is refused, and a
 * signed-in user without access gets a 403 (`beta_access_required`) from every
 * gated server route (`isBetaGatedServerPath`: tRPC, chat, Run, attachments,
 * uploads, ads campaigns, device auth, …), or a redirect to the private beta
 * screen from `/new/*` navigations. Requests without a session pass through
 * to the route, which answers them as before.
 */
export function createBetaAccessGate(deps: BetaAccessGateDeps) {
  return async (request: Request): Promise<Response | null> => {
    if (!deps.required) return null;
    const { pathname } = new URL(request.url);
    if (isGuestSignInPath(pathname)) {
      return request.method === "POST" ? betaAccessDeniedResponse() : null;
    }
    if (!isBetaGatedServerPath(pathname) || !hasSessionCookie(request)) return null;

    const session = await deps.getSession(request.headers);
    if (!session?.user || (await deps.hasAccess(session.user))) return null;
    if (!pathname.startsWith("/api/")) {
      return new Response(null, {
        status: 307,
        headers: {
          Location: new URL(BETA_ACCESS_PATH, request.url).toString(),
          "Cache-Control": "private, no-store",
        },
      });
    }
    return betaAccessDeniedResponse();
  };
}

/** The gate wired to this app's env, Better Auth and database. */
export function betaAccessGateResponse(request: Request) {
  return createBetaAccessGate({
    required: isBetaAccessRequired(),
    getSession: async (headers) => {
      const { auth } = await import("@/lib/auth");
      return auth.api.getSession({ headers });
    },
    hasAccess: (user) => hasBetaAccess(user, { required: true }),
  })(request);
}
