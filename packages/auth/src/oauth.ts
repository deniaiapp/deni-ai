/**
 * Shared rules of the Deni AI OAuth provider (`@better-auth/oauth-provider`),
 * used by the auth server and by the web app when it accepts the provider's
 * access tokens as `Authorization: Bearer` credentials.
 */

/**
 * Scope that lets a first-party native client (Deni AI Desktop) use the chat
 * API: the client API under `/api/client/v1`, sending and stopping messages, and
 * attachments. It never reaches billing, API keys or account settings.
 */
export const CHAT_SCOPE = "chat";

/** Every scope the provider issues: the plugin defaults plus {@link CHAT_SCOPE}. */
export const OAUTH_SCOPES = ["openid", "profile", "email", "offline_access", CHAT_SCOPE] as const;

/**
 * How access, refresh and authorization-code tokens are stored: SHA-256,
 * base64url without padding. This is the plugin's own default (`"hashed"`),
 * written out so the web app can look up a presented access token with the same
 * function instead of depending on the plugin's internals. Changing it
 * invalidates every issued token.
 */
export async function hashOAuthToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Whether a request names a bearer credential at all, valid or not. */
export function hasBearerAuthorization(headers: Headers): boolean {
  return /^bearer\b/i.test(headers.get("authorization")?.trim() ?? "");
}

/**
 * The token of an `Authorization: Bearer <token>` header, or null. Case of the
 * scheme is ignored (RFC 6750 §2.1); anything after the token is rejected.
 */
export function parseBearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}
