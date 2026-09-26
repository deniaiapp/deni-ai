import "server-only";

import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { mutateStore } from "./store";
import { appUrl, getStripe, proPriceId } from "./stripe";
import { userStorageKey } from "./paths";

export async function checkoutUrl(userId: string, email: string, req: Request) {
  // Hold the database row lock across Stripe calls so separate app instances
  // also reuse the same open checkout instead of creating multiple contracts.
  return mutateStore(userId, async (store) => {
    const stripe = getStripe();
    const billing = (store.billing ??= {
      plan: "free",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeStatus: null,
      currentPeriodEnd: null,
    });
    const key = userStorageKey(userId);
    if (!billing.stripeCustomerId && billing.stripeSubscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(billing.stripeSubscriptionId);
      billing.stripeCustomerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
    }
    if (!billing.stripeCustomerId) {
      const customer = await stripe.customers.create(
        { email, metadata: { userId } },
        { idempotencyKey: `customer:${key}` },
      );
      billing.stripeCustomerId = customer.id;
    }
    const customer = billing.stripeCustomerId;
    for await (const subscription of stripe.subscriptions.list({
      customer,
      status: "all",
      limit: 100,
    })) {
      if (!["canceled", "incomplete_expired"].includes(subscription.status)) {
        const portal = await stripe.billingPortal.sessions.create({
          customer,
          return_url: `${appUrl(req)}/upgrade`,
        });
        return portal.url;
      }
    }
    const sessions = await stripe.checkout.sessions.list({ customer, limit: 1 });
    const previous = sessions.data[0];
    if (previous?.status === "open" && previous.url) return previous.url;
    // A completed checkout can precede subscription visibility. Never create a
    // second checkout while that payment is still being resolved.
    if (previous?.status === "complete" && previous.subscription) {
      const subscription =
        typeof previous.subscription === "string"
          ? await stripe.subscriptions.retrieve(previous.subscription)
          : previous.subscription;
      if (!["canceled", "incomplete_expired"].includes(subscription.status)) {
        const portal = await stripe.billingPortal.sessions.create({
          customer,
          return_url: `${appUrl(req)}/upgrade`,
        });
        return portal.url;
      }
    }
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      line_items: [{ price: proPriceId(), quantity: 1 }],
      success_url: `${appUrl(req)}/upgrade?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl(req)}/upgrade`,
      client_reference_id: userId,
      customer,
      metadata: { userId },
      subscription_data: { metadata: { userId } },
      allow_promotion_codes: true,
    };
    // Each new checkout is a distinct Stripe operation. A fixed key based on the
    // previous session (or "initial") collides when the price/URL changes or an
    // expired session is no longer returned by Stripe's list endpoint.
    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: `checkout:${key}:${randomUUID()}`,
    });
    if (!session.url) throw new Error("Checkout URL is unavailable");
    return session.url;
  });
}
