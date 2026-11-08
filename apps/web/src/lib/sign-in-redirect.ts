import { toSafeRedirectPath } from "@/lib/auth-redirect";

/** Sign-in URL that returns to `returnTo` when it is a same-origin path, else /chat. */
export function signInPath(returnTo: string | null | undefined) {
  const params = new URLSearchParams({ redirectTo: toSafeRedirectPath(returnTo) });
  return `/auth/sign-in?${params.toString()}`;
}
