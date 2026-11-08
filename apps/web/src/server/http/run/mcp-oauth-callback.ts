import { auth } from "@/lib/auth";
import { signInPath } from "@/lib/sign-in-redirect";
import { ensureRunConfigured } from "@/lib/run/runtime.server";

/**
 * GET /api/run/mcp/oauth/callback: an MCP server's authorization page sends the
 * browser back here. The result is handed to the Run settings page as query params
 * (`mcp=<connection id>` or `mcpError=<message>`).
 */
export async function handleMcpOAuthCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const back = new URL("/run/settings", url.origin);
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.session?.userId;
  if (!userId || session?.user?.isAnonymous) {
    return Response.redirect(new URL(signInPath("/run/settings"), url.origin).toString(), 302);
  }
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  try {
    if (!ensureRunConfigured().ok) throw new Error("Deni Run is not configured.");
    if (!state || !code) throw new Error("The MCP server refused the sign-in. Start again.");
    const { finishMcpSignIn } = await import("@deniai/run/mcp/index");
    const connection = await finishMcpSignIn(userId, {
      state,
      code,
      iss: url.searchParams.get("iss"),
    });
    back.searchParams.set("mcp", connection.id);
  } catch (error) {
    back.searchParams.set(
      "mcpError",
      (error instanceof Error ? error.message : String(error)).slice(0, 300),
    );
  }
  return Response.redirect(back.toString(), 302);
}
