import { toSafeRedirectPath } from "@/lib/auth-redirect";

/**
 * Request header the proxy sets to the requested path + query. Layout auth
 * guards cannot see the URL, so they read it to send signed-out visitors back to
 * deep links (Flixa device codes, team invites) after sign-in.
 */
export const RETURN_TO_HEADER = "x-deni-return-to";

/** Sign-in URL that returns to `returnTo` when it is a same-origin path, else /chat. */
export function signInPath(returnTo: string | null | undefined) {
  const params = new URLSearchParams({ redirectTo: toSafeRedirectPath(returnTo) });
  return `/auth/sign-in?${params.toString()}`;
}
