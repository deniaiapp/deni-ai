import "server-only";

import type Stripe from "stripe";
import { getStripe, stripeConfigured } from "./stripe";
import { findUserIdByStripeCustomer, mutateStore, readStore } from "./store";
import type { PlanId } from "./types";

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export function planFromSubscription(subscription: Stripe.Subscription): {
  plan: PlanId;
  status: string;
  currentPeriodEnd: string | null;
} {
  const status = subscription.status;
  const periodEndUnix = subscription.items.data[0]?.current_period_end;
  return {
    plan: ACTIVE_STATUSES.has(status) ? "pro" : "free",
    status,
    currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
  };
}

export async function userIdFromCustomer(customerId: string, metadataUserId?: string | null) {
  if (metadataUserId) return metadataUserId;
  return findUserIdByStripeCustomer(customerId);
}

function customerIdOf(value: string | Stripe.Customer | Stripe.DeletedCustomer | null) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function writeBilling(
  userId: string,
  input: {
    plan: PlanId;
    stripeCustomerId: string;
    stripeSubscriptionId: string | null;
    stripeStatus: string | null;
    currentPeriodEnd: string | null;
  },
) {
  await mutateStore(userId, (store) => {
    store.billing ??= {
      plan: "free",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeStatus: null,
      currentPeriodEnd: null,
    };
    store.billing.plan = input.plan;
    store.billing.stripeCustomerId = input.stripeCustomerId;
    store.billing.stripeSubscriptionId =
      input.stripeSubscriptionId ?? store.billing.stripeSubscriptionId;
    store.billing.stripeStatus = input.stripeStatus;
    if (input.currentPeriodEnd) store.billing.currentPeriodEnd = input.currentPeriodEnd;
  });
}

export async function applySubscription(
  userId: string,
  subscription: Stripe.Subscription,
  customerId?: string | null,
) {
  const next = planFromSubscription(subscription);
  const stripeCustomerId = customerId || customerIdOf(subscription.customer);
  if (!stripeCustomerId) return false;
  await writeBilling(userId, {
    plan: next.plan,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    stripeStatus: next.status,
    currentPeriodEnd: next.currentPeriodEnd,
  });
  return true;
}

async function subscriptionFromSession(session: Stripe.Checkout.Session) {
  const ref = session.subscription;
  if (!ref) return null;
  if (typeof ref !== "string") return ref;
  return getStripe().subscriptions.retrieve(ref);
}

export async function applyCheckoutSession(
  expectedUserId: string | null,
  session: Stripe.Checkout.Session,
) {
  const fromSession = session.client_reference_id || session.metadata?.userId || null;
  const userId = fromSession || expectedUserId;
  if (!userId) return false;
  if (fromSession && expectedUserId && fromSession !== expectedUserId) return false;
  if (session.mode && session.mode !== "subscription") return false;
  if (session.status && session.status !== "complete") return false;

  const customerId = customerIdOf(session.customer);
  if (!customerId) return false;

  const subscription = await subscriptionFromSession(session);
  if (subscription) return applySubscription(userId, subscription, customerId);

  await writeBilling(userId, {
    plan: "pro",
    stripeCustomerId: customerId,
    stripeSubscriptionId: null,
    stripeStatus: "active",
    currentPeriodEnd: null,
  });
  return true;
}

export async function syncCheckoutSession(userId: string, sessionId: string) {
  if (!stripeConfigured()) return false;
  const session = await getStripe().checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  });
  return applyCheckoutSession(userId, session);
}

export async function syncCustomerSubscription(userId: string) {
  if (!stripeConfigured()) return false;
  const store = await readStore(userId);
  const customerId = store.billing?.stripeCustomerId;
  const subscriptionId = store.billing?.stripeSubscriptionId;
  const stripe = getStripe();
  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return applySubscription(userId, subscription);
  }
  if (!customerId) return false;
  const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 5 });
  const subscription =
    list.data.find((item) => ACTIVE_STATUSES.has(item.status)) ?? list.data[0];
  if (!subscription) return false;
  return applySubscription(userId, subscription, customerId);
}

export async function syncBilling(userId: string, sessionId?: string | null) {
  if (!stripeConfigured()) return false;
  if (sessionId) {
    const ok = await syncCheckoutSession(userId, sessionId);
    if (ok) return true;
  }
  return syncCustomerSubscription(userId);
}

export async function cancelUserSubscription(userId: string) {
  const store = await readStore(userId);
  const subscriptionId = store.billing?.stripeSubscriptionId;
  const customerId = store.billing?.stripeCustomerId;
  if (!subscriptionId && !customerId) return;
  const stripe = getStripe();
  const ids = new Set<string>();
  if (customerId) {
    for await (const session of stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 100 })) {
      if (session.mode === "subscription") await stripe.checkout.sessions.expire(session.id);
    }
    for await (const subscription of stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
      if (!["canceled", "incomplete_expired"].includes(subscription.status)) ids.add(subscription.id);
    }
  }
  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (!["canceled", "incomplete_expired"].includes(subscription.status)) ids.add(subscription.id);
  }
  for (const id of ids) await stripe.subscriptions.cancel(id);
}
