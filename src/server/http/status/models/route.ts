import { getModelHealth } from "@/lib/model-health";

export function GET() {
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
