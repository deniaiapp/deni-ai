import type Stripe from "stripe";

/** Statuses under which a subscription (still) grants its plan. */
const SUBSCRIPTION_ACCESS_STATUSES = new Set(["active", "trialing", "past_due", "canceled"]);

/** `canceled` means "cancels at period end"; fully ended subscriptions are `inactive`. */
export function grantsSubscriptionAccess(status: string | null | undefined) {
  return SUBSCRIPTION_ACCESS_STATUSES.has(status ?? "");
}

/**
 * The status stored for a Stripe subscription. A fully ended subscription keeps
 * its last period end, so storing `canceled` for it would read as a paid grace
 * period: it becomes `inactive`, and `canceled` is kept for "cancels at period end".
 */
export function resolveSubscriptionStatus(
  subscription: Pick<Stripe.Subscription, "status" | "cancel_at_period_end" | "cancel_at">,
) {
  if (subscription.status === "canceled") return "inactive";
  return subscription.cancel_at_period_end === true || subscription.cancel_at
    ? "canceled"
    : subscription.status;
}

/** Dispute outcomes that leave the funds with the merchant. */
const SETTLED_DISPUTE_STATUSES = new Set(["won", "warning_closed"]);

export function isSettledDispute(status: string) {
  return SETTLED_DISPUTE_STATUSES.has(status);
}
