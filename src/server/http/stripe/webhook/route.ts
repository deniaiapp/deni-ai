import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db/drizzle";
import { billing, user } from "@/db/schema";
import { env } from "@/env";
import { findPlanByLookupKey, isTeamPlan } from "@/lib/billing";
import { activatePaidAd, pauseReversedAdCharge, releaseExpiredAdCheckout } from "@/lib/ad-checkout";
import { getBillingFingerprintUpdates } from "@/lib/billing-card-usage";
import {
  findPaidLifetimePurchase,
  grantsSubscriptionAccess,
  resolveSubscriptionStatus,
  isLifetimePlanId,
  isPaidLifetimeRecord,
  isSettledDispute,
  saveLifetimePlan,
  restoreDisputedLifetimeCharge,
  revokeReversedLifetimeCharge,
} from "@/lib/lifetime-plan";
import {
  grantMaxModeCreditCheckout,
  grantMaxModeCreditTopUp,
  MAX_MODE_CREDIT_PURPOSE,
  restoreMaxModeCredits,
  revokeMaxModeCredits,
} from "@/lib/max-mode-credits";
import { stripe } from "@/lib/stripe";
import { readRequestBody, RequestBodyTooLargeError } from "@/lib/request-body";
import { saveTeamBillingRecord } from "@/lib/team-billing-record";
import {
  handleChargeDisputeClosed,
  handleChargeDisputeCreated,
  handleEarlyFraudWarning,
} from "@/lib/stripe-disputes";
import {
  getLicensedPrice,
  getSubscriptionPeriodEnd,
  isMaxModeOnlySubscription,
} from "@/lib/stripe-subscriptions";
import {
  cancelOrgMembersPersonalSubscriptions,
  getTeamBilling,
  recordTeamAuditEvent,
  updateTeamSeatCount,
} from "@/lib/team-billing";

/**
 * A team subscription belongs to its organization: its row is found by
 * organization, and `userId` is only an existing user to credit, if any. A
 * personal subscription always has its user.
 */
type BillingOwner =
  | { organizationId: string; userId: string | null }
  | { organizationId: null; userId: string };

type SubscriptionPayload = BillingOwner & {
  customerId: string;
  subscriptionId: string;
  lookupKey: string | null | undefined;
  priceId: string | null | undefined;
  status: string | null;
  currentPeriodEnd: number | null;
};

async function saveSubscription(payload: SubscriptionPayload) {
  const plan = findPlanByLookupKey(payload.lookupKey ?? undefined);
  const organizationId = payload.organizationId;
  const fingerprintUpdates = await getBillingFingerprintUpdates({
    customerId: payload.customerId,
    subscriptionId: payload.subscriptionId,
  });

  const whereClause =
    payload.organizationId === null
      ? and(eq(billing.userId, payload.userId), isNull(billing.organizationId))
      : eq(billing.organizationId, payload.organizationId);

  const [existingRecord] = await db
    .select({
      currentPeriodEnd: billing.currentPeriodEnd,
      firstPaidAt: billing.firstPaidAt,
      maxModeEnabled: billing.maxModeEnabled,
      planId: billing.planId,
      status: billing.status,
      mode: billing.mode,
      stripeSubscriptionId: billing.stripeSubscriptionId,
    })
    .from(billing)
    .where(whereClause)
    .limit(1);

  if (
    !grantsSubscriptionAccess(payload.status) &&
    existingRecord?.stripeSubscriptionId &&
    existingRecord.stripeSubscriptionId !== payload.subscriptionId
  )
    return;

  // A subscription that grants nothing (incomplete, ended, ...) must not replace a
  // paid lifetime plan, and an ended one hands the row back to that lifetime plan.
  if (payload.organizationId === null && !grantsSubscriptionAccess(payload.status)) {
    if (isPaidLifetimeRecord(existingRecord)) {
      return;
    }
    if (existingRecord?.firstPaidAt) {
      const lifetime = await findPaidLifetimePurchase(payload.customerId);
      if (lifetime) {
        await saveLifetimePlan(db, {
          userId: payload.userId,
          customerId: payload.customerId,
          purchase: lifetime,
          expectedSubscriptionId: payload.subscriptionId,
        });
        return;
      }
    }
  }

  const updates = {
    stripeCustomerId: payload.customerId,
    stripeSubscriptionId: payload.subscriptionId,
    priceId: payload.priceId ?? null,
    planId: plan?.id ?? null,
    status: payload.status ?? null,
    mode: "subscription" as const,
    currentPeriodEnd: payload.currentPeriodEnd ? new Date(payload.currentPeriodEnd * 1000) : null,
    organizationId,
    flashOfferEndsAt: organizationId ? undefined : null,
    firstPaidAt:
      organizationId || payload.status === "trialing" || payload.status == null
        ? undefined
        : (existingRecord?.firstPaidAt ?? new Date()),
    paymentMethodFingerprint: fingerprintUpdates.paymentMethodFingerprint,
    cardFunding: fingerprintUpdates.cardFunding,
    cardRemovedAt: fingerprintUpdates.cardRemovedAt,
  };

  if (payload.organizationId !== null) {
    await saveTeamBillingRecord(
      db,
      payload.userId,
      payload.organizationId,
      updates,
      grantsSubscriptionAccess(payload.status) ? undefined : payload.subscriptionId,
    );
  } else
    await db
      .insert(billing)
      .values({
        userId: payload.userId,
        ...updates,
      })
      .onConflictDoUpdate({
        target: organizationId ? [billing.userId, billing.organizationId] : billing.userId,
        targetWhere: organizationId
          ? sql`organization_id IS NOT NULL`
          : sql`organization_id IS NULL`,
        set: {
          ...updates,
          updatedAt: new Date(),
        },
        setWhere: grantsSubscriptionAccess(payload.status)
          ? undefined
          : or(
              isNull(billing.stripeSubscriptionId),
              eq(billing.stripeSubscriptionId, payload.subscriptionId),
            ),
      });
}

async function clearPlanData(owner: BillingOwner & { customerId: string; subscriptionId: string }) {
  const { customerId, subscriptionId } = owner;
  if (owner.organizationId !== null) {
    const saved = await saveTeamBillingRecord(
      db,
      owner.userId,
      owner.organizationId,
      {
        stripeCustomerId: customerId,
        stripeSubscriptionId: null,
        priceId: null,
        planId: null,
        status: "inactive",
        mode: null,
        currentPeriodEnd: null,
        checkoutSessionId: null,
        cancelAt: null,
      },
      subscriptionId,
    );
    return Boolean(saved);
  }

  const { userId } = owner;
  // The subscription ended; a lifetime plan bought earlier takes over again.
  const lifetime = await findPaidLifetimePurchase(customerId);
  if (lifetime) {
    return Boolean(
      await saveLifetimePlan(db, {
        userId,
        customerId,
        purchase: lifetime,
        expectedSubscriptionId: subscriptionId,
      }),
    );
  }

  const [saved] = await db
    .update(billing)
    .set({
      stripeCustomerId: customerId,
      stripeSubscriptionId: null,
      priceId: null,
      planId: null,
      status: "inactive",
      mode: null,
      currentPeriodEnd: null,
      checkoutSessionId: null,
      cancelAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(billing.userId, userId),
        isNull(billing.organizationId),
        eq(billing.stripeSubscriptionId, subscriptionId),
      ),
    )
    .returning({ id: billing.id });
  return Boolean(saved);
}

/**
 * Activates a paid one-time plan even when the buyer never returns to the
 * checkout page (which is the only other place that confirms it).
 */
async function savePaidLifetimeCheckout(
  session: Stripe.Checkout.Session,
  userId: string,
  planId: string,
) {
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customerId) return;

  const [existing] = await db
    .select()
    .from(billing)
    .where(and(eq(billing.userId, userId), isNull(billing.organizationId)))
    .limit(1);

  // A live subscription keeps the row; the lifetime plan is restored from Stripe
  // once that subscription ends.
  if (
    existing?.stripeSubscriptionId &&
    existing.mode === "subscription" &&
    grantsSubscriptionAccess(existing.status)
  ) {
    return;
  }

  const [lineItems, fingerprintUpdates] = await Promise.all([
    stripe.checkout.sessions.listLineItems(session.id, { limit: 1 }),
    getBillingFingerprintUpdates({ customerId }),
  ]);

  await saveLifetimePlan(db, {
    userId,
    customerId,
    purchase: {
      planId,
      priceId: lineItems.data.at(0)?.price?.id ?? null,
      checkoutSessionId: session.id,
    },
    expectedBillingRecord: existing ?? null,
    extra: {
      firstPaidAt: existing?.firstPaidAt ?? new Date(),
      flashOfferEndsAt: null,
      paymentMethodFingerprint: fingerprintUpdates.paymentMethodFingerprint,
      ...(fingerprintUpdates.cardFunding ? { cardFunding: fingerprintUpdates.cardFunding } : {}),
      cardRemovedAt: fingerprintUpdates.cardRemovedAt,
    },
  });
}

function paymentIntentIdOf(charge: Stripe.Charge) {
  return typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : (charge.payment_intent?.id ?? null);
}

async function resolveUserIdFromCustomer(
  stripeCustomerId: string,
  metadataUserId?: string | null,
): Promise<string | null> {
  if (metadataUserId) return metadataUserId;

  try {
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    if (customer && !("deleted" in customer) && customer.metadata?.userId) {
      return customer.metadata.userId;
    }
  } catch (error) {
    console.warn("Unable to load customer for userId resolution", error);
  }

  // A team row whose billing contact left or was deleted has no user.
  const [record] = await db
    .select({ userId: billing.userId })
    .from(billing)
    .where(and(eq(billing.stripeCustomerId, stripeCustomerId), isNotNull(billing.userId)))
    .limit(1);

  return record?.userId ?? null;
}

function resolveOrganizationId(metadata?: Stripe.Metadata | null): string | null {
  // Empty metadata is no organization, as every truthiness check here assumes.
  return metadata?.organizationId || null;
}

/**
 * A team subscription is applied without a user: its payer or billing contact
 * may since have deleted their account, which Stripe metadata still names, and
 * team audit entries may not reference a missing user. Null for a personal
 * subscription whose user is unknown.
 */
async function resolveBillingOwner(
  organizationId: string | null,
  userId: string | null | undefined,
): Promise<BillingOwner | null> {
  if (!organizationId) return userId ? { organizationId: null, userId } : null;
  if (!userId) return { organizationId, userId: null };
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return { organizationId, userId: existing?.id ?? null };
}

export async function POST(req: Request) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: "Stripe webhook is disabled" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const body = Buffer.from(await readRequestBody(req, 4 * 1024 * 1024));
    event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return Response.json({ error: "Webhook body is too large" }, { status: 413 });
    console.error("Stripe webhook signature verification failed", error);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        if (
          typeof subscription !== "object" ||
          subscription === null ||
          subscription.object !== "subscription"
        ) {
          break;
        }

        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;
        if (!customerId) {
          break;
        }

        // A legacy metered Max Mode host is not a plan; its end leaves the plan
        // and the prepaid-credit Max Mode alone.
        if (isMaxModeOnlySubscription(subscription)) {
          break;
        }

        const organizationId = resolveOrganizationId(subscription.metadata);
        const owner = await resolveBillingOwner(
          organizationId,
          await resolveUserIdFromCustomer(customerId, subscription.metadata?.userId),
        );

        if (!owner) {
          console.warn("[stripe:webhook] missing userId for deleted subscription", {
            subscriptionId: subscription.id,
          });
          break;
        }

        // Read the plan before clearPlanData wipes it, for the audit log below.
        const previousTeamBilling = organizationId ? await getTeamBilling(organizationId) : null;

        const cleared = await clearPlanData({
          ...owner,
          customerId,
          subscriptionId: subscription.id,
        });

        if (organizationId && cleared) {
          // Best-effort: if the organization was deleted as part of this same
          // cancellation (beforeDeleteOrganization cancels the subscription,
          // which triggers this webhook asynchronously afterwards), the
          // organizationId FK may already be gone by the time this runs — the
          // audit trail is moot in that case since the org's log is gone too.
          try {
            await recordTeamAuditEvent({
              organizationId,
              actorUserId: owner.userId,
              action: "subscription_expired",
              metadata: { planId: previousTeamBilling?.planId ?? null },
            });
          } catch (error) {
            console.warn("[stripe:webhook] Failed to record subscription_expired audit event", {
              organizationId,
              error,
            });
          }
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const eventSubscription = event.data.object;
        if (
          typeof eventSubscription !== "object" ||
          eventSubscription === null ||
          eventSubscription.object !== "subscription"
        ) {
          break;
        }

        // Stripe does not guarantee delivery order, and retries re-send old snapshots. Acting
        // on the event's own copy could undo a newer cancellation, so read the current state.
        let subscription: Stripe.Subscription;
        try {
          subscription = await stripe.subscriptions.retrieve(eventSubscription.id);
        } catch (error) {
          // The subscription no longer exists in Stripe; there is nothing to apply.
          if ((error as { code?: unknown } | null)?.code === "resource_missing") {
            break;
          }
          throw error;
        }

        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;
        if (!customerId) {
          break;
        }

        // Legacy metered Max Mode hosts carry no plan.
        if (isMaxModeOnlySubscription(subscription)) {
          break;
        }

        const price =
          getLicensedPrice(subscription) ?? subscription.items?.data?.[0]?.price ?? null;
        const priceId = price?.id ?? null;
        const lookupKey = price?.lookup_key ?? null;
        const organizationId = resolveOrganizationId(subscription.metadata);
        const owner = await resolveBillingOwner(
          organizationId,
          await resolveUserIdFromCustomer(customerId, subscription.metadata?.userId),
        );
        const computedStatus = resolveSubscriptionStatus(subscription);

        if (!owner) {
          console.warn("[stripe:webhook] missing userId for subscription", {
            subscriptionId: subscription.id,
          });
          break;
        }

        // Read the previous status before saveSubscription overwrites it, so we
        // can tell a *transition* into past_due from a status that was already
        // past_due (this event also fires on unrelated renewals/updates).
        const previousTeamBilling = organizationId ? await getTeamBilling(organizationId) : null;

        await saveSubscription({
          ...owner,
          customerId,
          subscriptionId: subscription.id,
          lookupKey,
          priceId,
          status: computedStatus,
          currentPeriodEnd: getSubscriptionPeriodEnd(subscription),
        });

        // When a team subscription becomes active, cancel all org members' personal subs
        if (
          organizationId &&
          subscription.status === "active" &&
          lookupKey &&
          isTeamPlan(findPlanByLookupKey(lookupKey)?.id ?? "")
        ) {
          // Members who joined while checkout was open were never billed as seats.
          await updateTeamSeatCount(organizationId);
          await cancelOrgMembersPersonalSubscriptions(organizationId);
        }

        if (
          organizationId &&
          computedStatus === "past_due" &&
          previousTeamBilling?.status !== "past_due"
        ) {
          try {
            await recordTeamAuditEvent({
              organizationId,
              actorUserId: owner.userId,
              action: "payment_failed",
              metadata: { planId: findPlanByLookupKey(lookupKey)?.id ?? null },
            });
          } catch (error) {
            console.warn("[stripe:webhook] Failed to record payment_failed audit event", {
              organizationId,
              error,
            });
          }
        }
        break;
      }
      case "checkout.session.expired": {
        await releaseExpiredAdCheckout(event.data.object);
        break;
      }
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.metadata?.adCampaignId) {
          await activatePaidAd(session);
          break;
        }
        if (session.metadata?.purpose === MAX_MODE_CREDIT_PURPOSE) {
          await grantMaxModeCreditCheckout(session);
          break;
        }
        if (session.mode === "subscription" && session.subscription) {
          const subscription =
            typeof session.subscription === "string"
              ? await stripe.subscriptions.retrieve(session.subscription)
              : session.subscription;

          let userId: string | null | undefined =
            session.metadata?.userId ?? subscription.metadata?.userId;

          if (!userId && typeof session.customer === "string") {
            userId = await resolveUserIdFromCustomer(session.customer, session.metadata?.userId);
          }

          const organizationId =
            resolveOrganizationId(session.metadata) ?? resolveOrganizationId(subscription.metadata);
          const owner = await resolveBillingOwner(organizationId, userId);

          if (owner) {
            const computedStatus = resolveSubscriptionStatus(subscription);

            const price =
              subscription.items.data.at(0)?.price ?? session.line_items?.data.at(0)?.price ?? null;
            await saveSubscription({
              ...owner,
              customerId: session.customer as string,
              subscriptionId: subscription.id,
              lookupKey: price?.lookup_key ?? null,
              priceId: price?.id ?? null,
              status: computedStatus,
              currentPeriodEnd: getSubscriptionPeriodEnd(subscription),
            });

            if (organizationId) {
              const plan = findPlanByLookupKey(price?.lookup_key ?? undefined);
              // The checkout's quantity was the member count when it was opened.
              if (subscription.status === "active" && isTeamPlan(plan?.id ?? "")) {
                await updateTeamSeatCount(organizationId);
              }
              await recordTeamAuditEvent({
                organizationId,
                actorUserId: owner.userId,
                action: "subscription_purchased",
                metadata: { planId: plan?.id ?? null },
              });
            }
          }
        } else if (session.mode === "payment" && session.payment_status === "paid") {
          const userId =
            session.metadata?.userId ??
            session.client_reference_id ??
            (typeof session.customer === "string"
              ? await resolveUserIdFromCustomer(session.customer)
              : null);
          const planId = session.metadata?.planId;

          if (userId && isLifetimePlanId(planId) && !session.metadata?.organizationId) {
            await savePaidLifetimeCheckout(session, userId, planId);
          }
        }
        break;
      }
      case "payment_intent.succeeded": {
        // Off-session auto top-ups grant directly; this covers a lost response.
        await grantMaxModeCreditTopUp(event.data.object);
        break;
      }
      case "charge.refunded": {
        await revokeReversedLifetimeCharge(event.data.object);
        await pauseReversedAdCharge(event.data.object);
        const creditPaymentIntent = paymentIntentIdOf(event.data.object);
        if (creditPaymentIntent) await revokeMaxModeCredits(creditPaymentIntent);
        break;
      }
      case "charge.dispute.created": {
        const dispute = event.data.object;
        if (typeof dispute !== "object" || dispute === null || dispute.object !== "dispute") {
          break;
        }
        const charge =
          typeof dispute.charge === "string"
            ? await stripe.charges.retrieve(dispute.charge)
            : dispute.charge;
        await revokeReversedLifetimeCharge(charge);
        await pauseReversedAdCharge(charge);
        const creditPaymentIntent = paymentIntentIdOf(charge);
        if (creditPaymentIntent) await revokeMaxModeCredits(creditPaymentIntent);
        await handleChargeDisputeCreated(dispute);
        break;
      }
      case "charge.dispute.closed": {
        const dispute = event.data.object;
        if (typeof dispute !== "object" || dispute === null || dispute.object !== "dispute") {
          break;
        }
        // charge.dispute.created revoked the lifetime plan; a dispute decided in
        // our favor (or an inquiry closed without one) gives it back.
        if (isSettledDispute(dispute.status)) {
          const charge =
            typeof dispute.charge === "string"
              ? await stripe.charges.retrieve(dispute.charge)
              : dispute.charge;
          await restoreDisputedLifetimeCharge(charge);
          const creditPaymentIntent = paymentIntentIdOf(charge);
          if (creditPaymentIntent) await restoreMaxModeCredits(creditPaymentIntent);
        }
        await handleChargeDisputeClosed(dispute);
        break;
      }
      case "radar.early_fraud_warning.created": {
        const warning = event.data.object;
        if (
          typeof warning !== "object" ||
          warning === null ||
          warning.object !== "radar.early_fraud_warning"
        ) {
          break;
        }
        await handleEarlyFraudWarning(warning);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error("Error handling Stripe webhook", error);
    return Response.json({ received: true }, { status: 500 });
  }

  return Response.json({ received: true }, { status: 200 });
}
