import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import {
  deleteMcpConnection,
  listMcpConnections,
  saveMcpConnection,
  testMcpConnection,
} from "@/lib/mcp";
import { getExtracted } from "@/i18n/server";
import { localizeError } from "@/lib/localize-error";

async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  return Response.json({ connections: await listMcpConnections(userId) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

async function POST({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json().catch(() => ({}))) as {
    action?: "save" | "test" | "delete";
    id?: string;
    name?: string;
    url?: string;
    transport?: "streamable-http" | "sse";
    secret?: string;
    headers?: Record<string, string>;
    enabled?: boolean;
  };
  try {
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

export const Route = createFileRoute("/api/mcp")({
  server: { handlers: { GET, POST } },
});
