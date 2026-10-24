import { connection } from "next/server";
import { getModelHealth } from "@/lib/model-health";

export async function GET() {
  // Results live in this server's memory: read them per request, never at build time.
  await connection();
  const rows = getModelHealth();
  return Response.json(
    {
      models: rows.map((row) => ({
        model: row.model,
        provider: row.provider,
        available: row.available,
        latencyMs: row.latencyMs,
        checkedAt: row.checkedAt,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
