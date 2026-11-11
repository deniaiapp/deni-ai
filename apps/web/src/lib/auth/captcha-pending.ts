import { clientEnv } from "@/public-env";

/**
 * Whether an auth form must wait for the captcha: the form shows one, Turnstile is
 * configured, and no token is set yet (`x-captcha-response`, cleared again after a
 * failed submission). Submitting before then only fails on the server.
 */
export function isCaptchaPending(
  hasCaptcha: boolean,
  fetchOptions: { headers?: Record<string, string> } | undefined,
  siteKey: string | undefined = clientEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
) {
  return hasCaptcha && Boolean(siteKey) && !fetchOptions?.headers?.["x-captcha-response"];
}
