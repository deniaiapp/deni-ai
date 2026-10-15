import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { syncBilling } from "@/lib/billing";
import { stripeConfigured } from "@/lib/stripe";
import { getUsageSnapshot } from "@/lib/usage";
import { getExtracted } from "@/i18n/server";

async function POST({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  if (!stripeConfigured()) {
    return Response.json({ error: t("Billing is not configured yet") }, { status: 501 });
  }
  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  const sessionId = body.sessionId?.trim() || null;
  await syncBilling(userId, sessionId);
  return Response.json({ usage: await getUsageSnapshot(userId) });
}

export const Route = createFileRoute("/api/billing/sync")({
  server: { handlers: { POST } },
});
