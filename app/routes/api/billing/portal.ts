import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { appUrl, getStripe, stripeConfigured } from "@/lib/stripe";
import { readStore } from "@/lib/store";
import { getExtracted } from "@/i18n/server";

async function POST({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  if (!stripeConfigured()) {
    return Response.json({ error: t("Billing is not configured yet") }, { status: 501 });
  }
  const store = await readStore(userId);
  const customerId = store.billing?.stripeCustomerId;
  if (!customerId) {
    return Response.json({ error: t("No billing account yet") }, { status: 400 });
  }
  const portal = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: appUrl(req),
  });
  return Response.json({ url: portal.url });
}

export const Route = createFileRoute("/api/billing/portal")({
  server: { handlers: { POST } },
});
