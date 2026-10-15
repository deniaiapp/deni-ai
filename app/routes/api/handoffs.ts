import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { getHandoff, listHandoffs } from "@/lib/handoff";
import { getExtracted } from "@/i18n/server";

async function GET({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const run = await getHandoff(userId, id);
    if (!run) return Response.json({ error: t("Handoff not found") }, { status: 404 });
    return Response.json(run);
  }
  return Response.json({ handoffs: await listHandoffs(userId) });
}

export const Route = createFileRoute("/api/handoffs")({
  server: { handlers: { GET } },
});
