/**
 * Private beta gate (v8 on beta.deniai.app): constants and path rules shared by
 * the request middleware (`src/start.ts`), the route guards and the UI. The
 * access check itself is server-only: `src/lib/beta-access.server.ts`.
 */

/** The screen signed-in users without access are sent to. */
export const BETA_ACCESS_PATH = "/private-beta";

/** Error code of the 403 every gated server route answers for users without access. */
export const BETA_ACCESS_REQUIRED_CODE = "beta_access_required";

/**
 * Server routes that stay open to signed-in users without access: sign-in and
 * sign-out (Better Auth), status, Stripe and cron (no user session), server to
 * server integrations, and ad delivery, which also serves signed-out visitors
 * on the public home page.
 */
const UNGATED_API_PREFIXES = [
  "/api/auth/",
  "/api/cron/",
  "/api/integrations/",
  "/api/status/",
  "/api/stripe/",
] as const;
const UNGATED_API_PATHS = new Set(["/api/ads", "/api/ads/click", "/api/ads/view"]);

/** Signed-in server routes outside `/api` (each GET creates a chat). */
const GATED_NON_API_PREFIXES = ["/new/"] as const;

function trimTrailingSlash(pathname: string) {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Whether a request path is a server route that must refuse a signed-in user
 * without beta access. Every `/api` route is gated unless listed above, so a
 * new endpoint is closed by default.
 */
export function isBetaGatedServerPath(pathname: string) {
  const path = trimTrailingSlash(pathname);
  if (GATED_NON_API_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (path !== "/api" && !path.startsWith("/api/")) return false;
  if (UNGATED_API_PATHS.has(path)) return false;
  return !UNGATED_API_PREFIXES.some((prefix) => `${path}/`.startsWith(prefix));
}

/** Guest sign-in creates an account the gate refuses anyway, so the gate refuses the sign-in. */
export function isGuestSignInPath(pathname: string) {
  return trimTrailingSlash(pathname) === "/api/auth/sign-in/anonymous";
}

/** Grants are stored and matched lower-cased and trimmed. */
export function normalizeBetaEmail(email: string) {
  return email.trim().toLowerCase();
}
