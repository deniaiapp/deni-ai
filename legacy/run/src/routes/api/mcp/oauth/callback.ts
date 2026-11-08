import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId } from "@/lib/auth/api";
import { finishMcpSignIn } from "@/lib/mcp";
import { localizeError } from "@/i18n/localize-error";
import { appUrl } from "@/lib/site";

/** Where an MCP server's authorization page sends the browser back after sign-in. */
async function GET({ request: req }: { request: Request }) {
  const url = new URL(req.url);
  // In development the callback may arrive through an https tunnel (MCP_OAUTH_BASE_URL); hand
  // it to the dev server's own origin, where the browser's session lives.
  const home = appUrl();
  if (process.env.NODE_ENV === "development" && home && new URL(home).host !== url.host) {
    return Response.redirect(`${home}${url.pathname}${url.search}`, 302);
  }
  const back = new URL("/", url.origin);
  back.searchParams.set("plugins", "1");
  const userId = await getApiUserId();
  if (!userId) return Response.redirect(new URL("/sign-in", url.origin).toString(), 302);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  try {
    // The user declined, or the server failed before issuing a code.
    if (!state || !code) throw new Error("The MCP server refused the sign-in. Start again.");
    const connection = await finishMcpSignIn(userId, { state, code, iss: url.searchParams.get("iss") });
    back.searchParams.set("mcp", connection.id);
  } catch (error) {
    back.searchParams.set("mcpError", await localizeError(error));
  }
  return Response.redirect(back.toString(), 302);
}

export const Route = createFileRoute("/api/mcp/oauth/callback")({
  server: { handlers: { GET } },
});
