import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { liveUsageSnapshot } from "@/lib/live-usage";
import { readStore } from "@/lib/store";

/** The usage meters, for a workspace that opened before Deni AI answered. */
async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  return Response.json({ usage: await liveUsageSnapshot(await readStore(userId), userId) }, { headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/usage")({
  server: { handlers: { GET } },
});
