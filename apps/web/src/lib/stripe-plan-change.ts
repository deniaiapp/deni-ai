import type Stripe from "stripe";

import { findPlanById, type BillingPlanId } from "@/lib/billing";
import { stripe } from "@/lib/stripe";
import { isMeteredMaxModePrice } from "@/lib/stripe-subscriptions";

/**
 * Plan changes on a live subscription (rules: `getPlanChangeKind` in @deniai/billing).
 *
 * An upgrade is applied to the subscription at once and starts a new billing cycle.
 * A downgrade waits for the end of the paid period in a Stripe subscription schedule:
 * the current phase keeps the subscription as it is until the period ends, the next
 * phase carries the new price, and the schedule then releases the subscription.
 * Stripe is the only place the pending change is stored, so v7, the webhook and the
 * agent API keep seeing the plan that is still paid for until the phase changes.
 */

/** A downgrade waiting for the end of the paid period. */
export type PendingPlanChange = { planId: BillingPlanId; effectiveAt: Date };

/** Schedule metadata key naming the plan the next phase switches to. */
const PENDING_PLAN_METADATA_KEY = "pendingPlanId";

/** Starts a new billing cycle now: the new plan in full, less the unused time on the old one. */
export const NEW_BILLING_CYCLE = {
  billing_cycle_anchor: { type: "now" },
  proration_behavior: "always_invoice",
} as const;

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** The schedule attached to a subscription (it carries a pending plan change), if any. */
export function getPlanChangeScheduleId(subscription: Stripe.Subscription): string | null {
  return idOf(subscription.schedule);
}

/**
 * The downgrade scheduled on a subscription retrieved with `expand: ["schedule"]`;
 * null when nothing is pending (or the schedule was not expanded).
 */
export function getPendingPlanChange(
  subscription: Stripe.Subscription,
  now = new Date(),
): PendingPlanChange | null {
  const schedule = subscription.schedule;
  if (!schedule || typeof schedule === "string" || schedule.status !== "active") return null;
  const plan = findPlanById(schedule.metadata?.[PENDING_PLAN_METADATA_KEY] ?? "");
  const next = schedule.phases.find((phase) => phase.start_date * 1000 > now.getTime());
  if (!plan || !next) return null;
  return { planId: plan.id, effectiveAt: new Date(next.start_date * 1000) };
}

/**
 * Drop a pending plan change: the subscription carries on as it is. Call it before
 * changing the subscription directly (upgrade, cancellation), which a schedule would
 * otherwise undo or refuse. Returns whether there was one.
 */
export async function releasePlanChangeSchedule(subscription: Stripe.Subscription) {
  const scheduleId = getPlanChangeScheduleId(subscription);
  if (!scheduleId) return false;
  await stripe.subscriptionSchedules.release(scheduleId);
  return true;
}

type PhaseDiscountParam = { discount?: string; coupon?: string; promotion_code?: string };

/** A phase's discounts as parameters, so rewriting the phases does not drop them. */
function phaseDiscounts(phase: Stripe.SubscriptionSchedule.Phase): PhaseDiscountParam[] {
  const discounts: PhaseDiscountParam[] = [];
  for (const entry of phase.discounts) {
    const discount = idOf(entry.discount);
    const coupon = idOf(entry.coupon);
    const promotionCode = idOf(entry.promotion_code);
    if (discount) discounts.push({ discount });
    else if (coupon) discounts.push({ coupon });
    else if (promotionCode) discounts.push({ promotion_code: promotionCode });
  }
  return discounts;
}

function currentPhaseOf(schedule: Stripe.SubscriptionSchedule) {
  const start = schedule.current_phase?.start_date;
  return schedule.phases.find((phase) => phase.start_date === start) ?? schedule.phases[0];
}

/**
 * Switch the subscription's plan item to `price` when the current billing period ends,
 * with no credit and no charge today. `quantity` sets the seats of the new phase (team
 * plans); other items (Max Mode meters) are carried over unchanged. A change already
 * pending is replaced.
 */
export async function schedulePlanChangeAtPeriodEnd({
  subscription,
  item,
  price,
  plan,
  quantity,
  metadata,
}: {
  subscription: Stripe.Subscription;
  /** The subscription's plan item (not a Max Mode meter). */
  item: Stripe.SubscriptionItem;
  price: Stripe.Price;
  plan: { id: BillingPlanId };
  quantity?: number;
  /** Subscription metadata from the moment the new plan starts. */
  metadata: Record<string, string>;
}): Promise<PendingPlanChange> {
  if (!price.recurring) throw new Error("A scheduled plan needs a recurring price.");
  const existingId = getPlanChangeScheduleId(subscription);
  const schedule = existingId
    ? await stripe.subscriptionSchedules.retrieve(existingId)
    : await stripe.subscriptionSchedules.create({ from_subscription: subscription.id });

  try {
    const current = currentPhaseOf(schedule);
    if (!current) throw new Error("Subscription schedule has no current phase.");
    const discounts = phaseDiscounts(current);
    const currentItems = current.items.map((entry) => ({
      price: idOf(entry.price)!,
      ...(entry.quantity == null ? {} : { quantity: entry.quantity }),
    }));
    const nextItems = currentItems.map((entry) =>
      entry.price === item.price.id
        ? { price: price.id, quantity: quantity ?? entry.quantity ?? 1 }
        : entry,
    );
    if (!nextItems.some((entry) => entry.price === price.id)) {
      throw new Error("Subscription schedule does not contain the plan item.");
    }

    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: "release",
      proration_behavior: "none",
      metadata: { [PENDING_PLAN_METADATA_KEY]: plan.id },
      phases: [
        {
          items: currentItems,
          start_date: current.start_date,
          end_date: current.end_date,
          ...(discounts.length > 0 ? { discounts } : {}),
        },
        {
          items: nextItems,
          // One billing period of the new plan; the schedule then releases the subscription.
          duration: {
            interval: price.recurring.interval,
            interval_count: price.recurring.interval_count,
          },
          proration_behavior: "none",
          metadata,
          ...(discounts.length > 0 ? { discounts } : {}),
        },
      ],
    });
    return { planId: plan.id, effectiveAt: new Date(current.end_date * 1000) };
  } catch (error) {
    // Do not leave a schedule we just attached and could not fill in.
    if (!existingId) {
      await stripe.subscriptionSchedules.release(schedule.id).catch((releaseError: unknown) => {
        console.error("[billing] Failed to release an unfinished plan change schedule", {
          scheduleId: schedule.id,
          error: releaseError,
        });
      });
    }
    throw error;
  }
}

/**
 * Keep a pending team plan change in step with the seat count: every phase's plan item
 * gets `quantity`, so the new plan starts with the seats the team has by then.
 */
export async function syncScheduledSeatCount(subscription: Stripe.Subscription, quantity: number) {
  const scheduleId = getPlanChangeScheduleId(subscription);
  if (!scheduleId) return;
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId, {
    expand: ["phases.items.price"],
  });
  if (schedule.status !== "active") return;
  const currentStart = schedule.current_phase?.start_date ?? 0;
  const phases = schedule.phases.filter((phase) => phase.start_date >= currentStart);
  await stripe.subscriptionSchedules.update(schedule.id, {
    proration_behavior: "none",
    phases: phases.map((phase) => {
      const discounts = phaseDiscounts(phase);
      return {
        items: phase.items.map((entry) => {
          const priceObject = typeof entry.price === "string" ? null : entry.price;
          const isPlanItem =
            entry.quantity != null &&
            !(priceObject && "lookup_key" in priceObject && isMeteredMaxModePrice(priceObject));
          return {
            price: idOf(entry.price)!,
            ...(isPlanItem
              ? { quantity }
              : entry.quantity == null
                ? {}
                : { quantity: entry.quantity }),
          };
        }),
        start_date: phase.start_date,
        end_date: phase.end_date,
        proration_behavior: "none" as const,
        ...(phase.metadata ? { metadata: phase.metadata } : {}),
        ...(discounts.length > 0 ? { discounts } : {}),
      };
    }),
  });
}
