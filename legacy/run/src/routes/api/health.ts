import { createFileRoute } from "@tanstack/react-router";
import { rawRows } from "@/db";

async function GET() {
  try {
    await rawRows("select 1");
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/health")({
  server: { handlers: { GET } },
});
