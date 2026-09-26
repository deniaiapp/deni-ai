// Opt-in development-only authentication bypass. Never enable in a deployed server.
export const LOCAL_USER_ID = "local-dev-user";
export const LOCAL_USER_EMAIL = "local@localhost.invalid";

export function isLocalAuthBypass(host: string | null) {
  if (process.env.NODE_ENV !== "development" || process.env.LOCAL_AUTH_BYPASS !== "true") return false;
  const hostname = host?.toLowerCase().replace(/:\d+$/, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
