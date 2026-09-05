import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import {
  deleteMcpConnection,
  listMcpConnections,
  saveMcpConnection,
  testMcpConnection,
} from "@/lib/mcp";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  return NextResponse.json({ connections: await listMcpConnections(userId) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
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
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      return NextResponse.json(await testMcpConnection(userId, body.id));
    }
    if (body.action === "delete") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const deleted = await deleteMcpConnection(userId, body.id);
      return deleted
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: "connection not found" }, { status: 404 });
    }
    if (!body.name || !body.url) {
      return NextResponse.json({ error: "name and url required" }, { status: 400 });
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
    return NextResponse.json({ connection }, { status: body.id ? 200 : 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
