import { createFileRoute } from "@tanstack/react-router";
import { getExtracted } from "@/i18n/server";
import type Stripe from "stripe";
import {
  applyCheckoutSession,
  applySubscription,
  userIdFromCustomer,
} from "@/lib/billing";
import { getStripe } from "@/lib/stripe";

function customerIdOf(value: string | Stripe.Customer | Stripe.DeletedCustomer | null) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function POST({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return Response.json({ error: t("webhook is not configured") }, { status: 501 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: t("missing signature") }, { status: 400 });
  }
  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch {
    return Response.json({ error: t("invalid signature") }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const customerId = customerIdOf(session.customer);
    const userId =
      session.client_reference_id ||
      session.metadata?.userId ||
      (customerId ? await userIdFromCustomer(customerId) : null);
    if (userId) await applyCheckoutSession(userId, session);
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = customerIdOf(subscription.customer);
    if (customerId) {
      const userId = await userIdFromCustomer(customerId, subscription.metadata?.userId);
      if (userId) await applySubscription(userId, subscription, customerId);
    }
  }

  return Response.json({ received: true });
}

export const Route = createFileRoute("/api/billing/webhook")({
  server: { handlers: { POST } },
});
