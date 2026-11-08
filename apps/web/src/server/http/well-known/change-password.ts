import { ACCOUNT_SECURITY_PATH } from "@/lib/auth-paths";

/**
 * WICG well-known change-password URL.
 * Password managers (Chrome, Safari, 1Password, etc.) send users here.
 *
 * @see https://w3c.github.io/webappsec-change-password-url/
 */
export function GET() {
  // 302/303/307 only — permanent redirects (301/308) may be cached and skip this
  // discovery URL if the change-password page later moves.
  return new Response(null, {
    status: 302,
    headers: {
      Location: ACCOUNT_SECURITY_PATH,
    },
  });
}
