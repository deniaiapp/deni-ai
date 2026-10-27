import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import {
  deleteMcpConnection,
  listMcpConnections,
  describeMcpTool,
  listMcpTools,
  mcpAlwaysAllowed,
  saveMcpConnection,
  setMcpAlwaysAllow,
  startMcpSignIn,
  testMcpConnection,
} from "@/lib/mcp";
import { limitOrResponse } from "@/lib/rate-limit";
import { oauthBaseUrl } from "@/lib/site";
import { getExtracted, getLocale } from "@/i18n/server";
import { explainMcpCall } from "@/lib/mcp-explain";
import { localizeError } from "@/lib/localize-error";

async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const connections = await listMcpConnections(userId);
  const alwaysAllow = Object.fromEntries(await Promise.all(connections.map(async (connection) => [connection.id, await mcpAlwaysAllowed(userId, connection.id)])));
  return Response.json({ connections, alwaysAllow }, {
    headers: { "Cache-Control": "no-store" },
  });
}

async function POST({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json().catch(() => ({}))) as {
    action?: "save" | "test" | "delete" | "connect" | "tools" | "describe" | "explain" | "always-allow";
    id?: string;
    catalogId?: string;
    tool?: string;
    arguments?: Record<string, unknown>;
    toolCallId?: string;
    savedOnly?: boolean;
    name?: string;
    url?: string;
    transport?: "streamable-http" | "sse";
    secret?: string;
    headers?: Record<string, string>;
    enabled?: boolean;
  };
  try {
    if (body.action === "connect") {
      if (!body.id && !body.catalogId) return Response.json({ error: t("ID is required") }, { status: 400 });
      const limited = await limitOrResponse(userId, "mcp-connect", 20);
      if (limited) return limited;
      return Response.json(await startMcpSignIn(userId, { id: body.id, catalogId: body.catalogId }, oauthBaseUrl() || new URL(req.url).origin));
    }
    if (body.action === "tools") {
      if (!body.id) return Response.json({ error: t("ID is required") }, { status: 400 });
      return Response.json(await listMcpTools(userId, body.id));
    }
    if (body.action === "describe") {
      if (!body.id || !body.tool) return Response.json({ error: t("ID is required") }, { status: 400 });
      const args = body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments) ? body.arguments : undefined;
      return Response.json(await describeMcpTool(userId, body.id, body.tool, args));
    }
    if (body.action === "explain") {
      if (!body.id || !body.tool) return Response.json({ error: t("ID is required") }, { status: 400 });
      // Answered cards only read a saved explanation, so a long history gets a looser limit.
      const limited = body.savedOnly === true
        ? await limitOrResponse(userId, "mcp-explain-saved", 300)
        : await limitOrResponse(userId, "mcp-explain", 60);
      if (limited) return limited;
      const args = body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments) ? body.arguments : undefined;
      const toolCallId = typeof body.toolCallId === "string" && body.toolCallId.length <= 200 ? body.toolCallId : undefined;
      return Response.json({
        explanation: await explainMcpCall(userId, body.id, body.tool, args, await getLocale(), {
          toolCallId,
          savedOnly: body.savedOnly === true,
        }),
      });
    }
    if (body.action === "always-allow") {
      if (!body.id || !body.tool || typeof body.enabled !== "boolean") return Response.json({ error: t("Invalid permission") }, { status: 400 });
      await setMcpAlwaysAllow(userId, body.id, body.tool, body.enabled);
      return Response.json({ alwaysAllow: await mcpAlwaysAllowed(userId, body.id) });
    }
    if (body.action === "test") {
      if (!body.id) return Response.json({ error: t("ID is required") }, { status: 400 });
      return Response.json(await testMcpConnection(userId, body.id));
    }
    if (body.action === "delete") {
      if (!body.id) return Response.json({ error: t("ID is required") }, { status: 400 });
      const deleted = await deleteMcpConnection(userId, body.id);
      return deleted
        ? Response.json({ ok: true })
        : Response.json({ error: t("Connection not found") }, { status: 404 });
    }
    if (!body.name || !body.url) {
      return Response.json({ error: t("Name and URL are required") }, { status: 400 });
    }
    const connection = await saveMcpConnection({
      userId,
      id: body.id,
      name: body.name,
      url: body.url,
      transport: body.transport,
      secret: body.secret,
      headers: body.headers,
      enabled: body.enabled,
    });
    return Response.json({ connection }, { status: body.id ? 200 : 201 });
  } catch (error) {
    return Response.json(
      { error: await localizeError(error) },
      { status: 400 },
    );
  }
}

export const Route = createFileRoute("/api/mcp/")({
  server: { handlers: { GET, POST } },
});
