export function supportEmail() {
  return process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "";
}

export function supportMailto() {
  const email = supportEmail();
  return email ? `mailto:${email}` : null;
}

/**
 * Origin MCP servers send OAuth callbacks to. In development MCP_OAUTH_BASE_URL can name an
 * https tunnel to this dev server, whose callback hands the browser back to localhost.
 */
export function oauthBaseUrl() {
  const tunnel = process.env.NODE_ENV === "development" ? process.env.MCP_OAUTH_BASE_URL?.trim() : "";
  return (tunnel || appUrl()).replace(/\/+$/, "");
}

/** Public origin of the app, without a trailing slash. */
export function appUrl() {
  return (process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
}
