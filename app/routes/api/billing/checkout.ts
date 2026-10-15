import { createFileRoute } from "@tanstack/react-router";
import { unauthorizedResponse } from "@/lib/api-auth";
import { getAuthSession } from "@/lib/auth";
import { limitOrResponse } from "@/lib/rate-limit";
import { stripeConfigured } from "@/lib/stripe";
import { checkoutUrl } from "@/lib/checkout";
import { getExtracted } from "@/i18n/server";

async function POST({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const sessionUser = await getAuthSession();
  if (!sessionUser) return unauthorizedResponse();
  const userId = sessionUser.user.id;
  const limited = await limitOrResponse(userId, "checkout", 8);
  if (limited) return limited;
  if (!stripeConfigured()) {
    return Response.json({ error: t("Billing is not configured yet") }, { status: 501 });
  }

  const url = await checkoutUrl(userId, sessionUser.user.email, req);
  return Response.json({ url });
}

export const Route = createFileRoute("/api/billing/checkout")({
  server: { handlers: { POST } },
});
