import { runConfig } from "@deniai/run/runtime";

/**
 * Origin MCP servers send OAuth callbacks to: the web app (the callback route lives in
 * apps/web). In development `MCP_OAUTH_BASE_URL` can name an https tunnel to the dev server.
 */
export function oauthBaseUrl() {
  const tunnel =
    process.env.NODE_ENV === "development" ? process.env.MCP_OAUTH_BASE_URL?.trim() : "";
  return (tunnel || runConfig().appUrl).replace(/\/+$/, "");
}
