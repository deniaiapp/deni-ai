import { createIsomorphicFn, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { TwoFactorPolicy } from "@/lib/two-factor-policy";

export type AuthState = {
  signedIn: boolean;
  isAnonymous: boolean;
  /** The password-account two-factor rule for this user (src/lib/two-factor-policy.ts). */
  twoFactor: TwoFactorPolicy;
  /** May use this deployment: always true unless the private beta gate is on (src/lib/beta-access.server.ts). */
  betaAccess: boolean;
  /** Verified operator (ADMIN_EMAILS / ADMIN_EMAIL_DOMAINS): sees the admin settings. */
  isAdmin: boolean;
};

// better-auth pulls in the database, mail templates and Stripe; load it on the
// first session check rather than with every module that imports this file.
const getAuthStateFn = createServerFn({ method: "GET" }).handler(async (): Promise<AuthState> => {
  const { auth } = await import("@/lib/auth");
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  const [{ getTwoFactorPolicyForUser }, { hasBetaAccess, isBetaAdmin }] = await Promise.all([
    import("@/lib/two-factor-policy.server"),
    import("@/lib/beta-access.server"),
  ]);
  const user = session?.session ? session.user : null;
  return {
    signedIn: Boolean(session?.session),
    isAnonymous: Boolean(session?.user?.isAnonymous),
    twoFactor: await getTwoFactorPolicyForUser(session?.user ?? null),
    betaAccess: user ? await hasBetaAccess(user) : false,
    isAdmin: isBetaAdmin(user),
  };
});

/**
 * Client navigations reuse a recent signed-in answer instead of a round trip per
 * chat switch. Signed-out answers are never reused, so signing in takes effect
 * on the next navigation.
 */
const CLIENT_AUTH_STATE_TTL_MS = 60_000;
let clientAuthState: { value: Promise<AuthState>; checkedAt: number } | null = null;

/**
 * Session check for route guards. Server renders always validate the session;
 * the browser briefly reuses a signed-in answer.
 */
export const getAuthState = createIsomorphicFn()
  .server(() => getAuthStateFn())
  .client(() => {
    const now = Date.now();
    if (!clientAuthState || now - clientAuthState.checkedAt > CLIENT_AUTH_STATE_TTL_MS) {
      const value = getAuthStateFn();
      clientAuthState = { value, checkedAt: now };
      value.then(
        (state) => {
          if (!state.signedIn) clientAuthState = null;
        },
        () => {
          clientAuthState = null;
        },
      );
    }
    return clientAuthState.value;
  });

/** Forget the cached session check (after sign-in/sign-out without a reload). */
export function resetAuthStateCache() {
  clientAuthState = null;
}
