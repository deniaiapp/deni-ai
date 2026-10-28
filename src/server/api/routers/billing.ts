import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull, isNull, like, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";
import { billing, member, user } from "@/db/schema";
import { env } from "@/env";
import {
  type BillingPlan,
  billingPlans,
  findPlanById,
  findPlanByLookupKey,
  isTeamPlan,
} from "@/lib/billing";
import {
  type CardFunding,
  claimCardVerification,
  grantCardVerificationFlashOffer,
} from "@/lib/billing-card-usage";
import { isBillingDisabled } from "@/lib/billing-config";
import { unchangedBillingSnapshot } from "@/lib/billing-snapshot";
import { getAccountDeletionStatus, getCardRemovalBlocker } from "@/lib/account-deletion-billing";
import {
  createFlashOfferEndAt,
  getFlashOfferCouponId,
  getFlashOfferLimit,
  isFlashOfferPlan,
} from "@/lib/billing-offers";
import { resolveSubscriptionStatus } from "@/lib/subscription-status";
import {
  disableMaxMode,
  enableMaxMode,
  getMaxModeCreditTarget,
  getMaxModeStatus,
} from "@/lib/max-mode";
import {
  createMaxModeCreditCheckout,
  MAX_MODE_AUTO_TOP_UP_THRESHOLD_MAX,
  MAX_MODE_AUTO_TOP_UP_THRESHOLD_MIN,
  MAX_MODE_CREDIT_MAX,
  MAX_MODE_CREDIT_MIN,
  updateMaxModeAutoTopUp,
} from "@/lib/max-mode-credits";
import { escapeStripeSearchValue } from "@/lib/stripe-search";
import { stripe } from "@/lib/stripe";
import { createBillingPortalSession } from "@/lib/stripe-portal";
import {
  checkoutCardPaymentMethodOptions,
  customCheckoutRequestOptions,
  requestThreeDSecure,
} from "@/lib/stripe-checkout";
import { checkoutSessionExpand, summarizeCheckoutSession } from "@/lib/stripe-checkout-receipt";
import {
  listCustomerSubscriptions,
  getLicensedPrice,
  getLicensedSubscriptionItem,
  getSubscriptionPeriodEndDate,
  isMaxModeOnlySubscription,
  isMeteredMaxModePrice,
  pickLicensedSubscription,
} from "@/lib/stripe-subscriptions";
import { getUsageSummary } from "@/lib/usage";
import {
  type ProtectedContext,
  protectedProcedure,
  rateLimited,
  router,
  TRPC_RATE_LIMITS,
  type TRPCRateLimit,
} from "../trpc";

const planIdSchema = z.enum([
  "go_monthly",
  "plus_monthly",
  "plus_yearly",
  "pro_monthly",
  "pro_yearly",
]);

type BillingRecord = typeof billing.$inferSelect;
const ACTIVE_SUB_STATUSES = new Set(["trialing", "active", "past_due"]);
const billingEnabledProcedure = protectedProcedure.use(({ ctx, next }) => {
  // Anonymous guest sessions have placeholder email addresses and must not
  // create Stripe customers. Sign in to a permanent account before billing.
  if (ctx.session?.user?.isAnonymous) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sign in before using billing." });
  }
  if (isBillingDisabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Billing is disabled.",
    });
  }
  return next();
});

/** Per-user budget for a read that calls Stripe on every call. */
const stripeRead = (name: string, limit: TRPCRateLimit = TRPC_RATE_LIMITS.stripeRead) =>
  rateLimited(`billing.${name}`, limit);

/** Per-user budget for a mutation that calls Stripe. */
const stripeWrite = (name: string, limit: TRPCRateLimit = TRPC_RATE_LIMITS.stripeWrite) =>
  rateLimited(`billing.${name}`, limit);

const CARD_VERIFICATION_AMOUNT = 100;

/**
 * The customer's newest card verification intent that is still waiting for a
 * card, created the way `createCardSetupIntent` creates one now.
 */
async function findOpenCardVerificationIntent(customerId: string, userId: string) {
  const intents = await stripe.paymentIntents.list({ customer: customerId, limit: 10 });
  return intents.data.find(
    (intent) =>
      intent.status === "requires_payment_method" &&
      intent.metadata?.purpose === "free_tier_verification" &&
      intent.metadata?.userId === userId &&
      intent.amount === CARD_VERIFICATION_AMOUNT &&
      intent.currency === "usd" &&
      intent.capture_method === "manual" &&
      intent.payment_method_options?.card?.request_three_d_secure === requestThreeDSecure,
  );
}

function deriveModeFromPrice(price: Stripe.Price | null | undefined): "subscription" | "payment" {
  if (!price) {
    return "subscription";
  }
  return price.recurring ? "subscription" : "payment";
}

async function getPriceForPlan(plan: BillingPlan) {
  const prices = await stripe.prices.list({
    lookup_keys: [plan.lookupKey],
    active: true,
    limit: 1,
  });

  const price = prices.data.at(0);
  if (!price) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unable to load ${plan.lookupKey} price. Configure lookup_key=${plan.lookupKey} in Stripe.`,
    });
  }

  return price;
}

/** Stripe accepts at most 10 lookup keys per `prices.list` call. */
const STRIPE_LOOKUP_KEY_BATCH_SIZE = 10;

/** Loads prices for several plans with one Stripe request per 10 lookup keys. */
async function getPricesForPlans(plans: BillingPlan[]) {
  const pricesByLookupKey = new Map<string, Stripe.Price>();
  const lookupKeys = [...new Set(plans.map((plan) => plan.lookupKey))];

  const batches: string[][] = [];
  for (let index = 0; index < lookupKeys.length; index += STRIPE_LOOKUP_KEY_BATCH_SIZE) {
    batches.push(lookupKeys.slice(index, index + STRIPE_LOOKUP_KEY_BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map((batch) =>
      stripe.prices.list({ lookup_keys: batch, active: true, limit: batch.length }),
    ),
  );
  for (const price of results.flatMap((result) => result.data)) {
    if (price.lookup_key && !pricesByLookupKey.has(price.lookup_key)) {
      pricesByLookupKey.set(price.lookup_key, price);
    }
  }

  return plans.map((plan) => {
    const price = pricesByLookupKey.get(plan.lookupKey);
    if (!price) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Unable to load ${plan.lookupKey} price. Configure lookup_key=${plan.lookupKey} in Stripe.`,
      });
    }
    return price;
  });
}

function getPlanFromPrice(price: Stripe.Price | null | undefined) {
  return findPlanByLookupKey(price?.lookup_key ?? undefined);
}

async function getFlashOfferCoupon() {
  const couponId = getFlashOfferCouponId();
  if (!couponId) {
    return null;
  }

  try {
    return await stripe.coupons.retrieve(couponId);
  } catch (error) {
    console.warn("Failed to load flash offer coupon", error);
    return null;
  }
}

/** The flash offer coupon and limit a personal billing record can use now, or null. */
async function resolveFlashOffer(
  record: Pick<BillingRecord, "firstPaidAt" | "flashOfferEndsAt"> | null | undefined,
) {
  // Skip the Stripe read when no offer can apply whatever the coupon's count is.
  if (!getFlashOfferLimit(record, 0)) {
    return null;
  }

  const coupon = await getFlashOfferCoupon();
  if (!coupon?.valid) {
    return null;
  }

  const limit = getFlashOfferLimit(record, coupon.times_redeemed);
  return limit ? { coupon, limit } : null;
}

function applyCouponToAmount(
  amount: number | null | undefined,
  coupon: Stripe.Coupon | null | undefined,
  currency: string | null | undefined,
) {
  if (amount == null || !coupon || !coupon.valid) {
    return amount ?? null;
  }

  if (coupon.currency && currency && coupon.currency.toLowerCase() !== currency.toLowerCase()) {
    return amount;
  }

  if (coupon.percent_off != null) {
    return Math.max(0, Math.round(amount * (1 - coupon.percent_off / 100)));
  }

  if (coupon.amount_off != null) {
    return Math.max(0, amount - coupon.amount_off);
  }

  return amount;
}

async function fetchUserProfile(ctx: ProtectedContext, userId: string) {
  const [profile] = await ctx.db
    .select({
      email: user.email,
      name: user.name,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!profile?.email) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "User profile missing an email address.",
    });
  }

  return profile;
}

async function findOrCreateStripeCustomer({
  email,
  name,
  userId,
}: {
  email: string;
  name?: string | null;
  userId: string;
}) {
  // Email is not an account identifier: different accounts may share or change it.
  // Fail closed on search errors rather than creating a duplicate customer.
  const query = `metadata['userId']:'${escapeStripeSearchValue(userId)}'`;
  let page: string | undefined;
  do {
    const search = await stripe.customers.search({ query, limit: 100, page });
    const personalCustomer = search.data.find((candidate) => !candidate.metadata.organizationId);
    if (personalCustomer) return personalCustomer;
    page = search.next_page ?? undefined;
  } while (page);

  return stripe.customers.create(
    { email, name: name ?? undefined, metadata: { userId } },
    { idempotencyKey: `billing-personal-${userId}` },
  );
}

async function ensureBillingRecord(ctx: ProtectedContext, userId: string) {
  const [initial] = await ctx.db
    .select()
    .from(billing)
    .where(and(eq(billing.userId, userId), isNull(billing.organizationId)))
    .limit(1);
  if (initial?.deletionPending)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Account deletion is in progress.",
    });
  if (initial && (initial.firstPaidAt || initial.flashOfferEndsAt)) return initial;

  // Release pooled reads before Stripe I/O. The account idempotency key keeps
  // concurrent creators on one customer; the transaction below rechecks the row.
  const profile = initial ? null : await fetchUserProfile(ctx, userId);
  const customer = profile
    ? await findOrCreateStripeCustomer({ email: profile.email, name: profile.name, userId })
    : null;
  return ctx.db.transaction(async (tx) => {
    // Serialize creation for this account across concurrent checkout and card requests.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${"personal:" + userId}, 0))`,
    );
    const existing = await tx
      .select()
      .from(billing)
      .where(and(eq(billing.userId, userId), isNull(billing.organizationId)))
      .limit(1);

    if (existing[0]) {
      const record = existing[0];
      if (!record.firstPaidAt && !record.flashOfferEndsAt) {
        const [updated] = await tx
          .update(billing)
          .set({
            flashOfferEndsAt: createFlashOfferEndAt(),
            updatedAt: new Date(),
          })
          .where(and(eq(billing.userId, userId), isNull(billing.organizationId)))
          .returning();

        return updated ?? record;
      }

      return record;
    }

    if (!customer) throw new Error("Personal billing record disappeared during creation");

    const [created] = await tx
      .insert(billing)
      .values({
        userId,
        stripeCustomerId: customer.id,
        status: "inactive",
        flashOfferEndsAt: createFlashOfferEndAt(),
      })
      .onConflictDoNothing()
      .returning();

    if (created) return created;
    const [record] = await tx
      .select()
      .from(billing)
      .where(and(eq(billing.userId, userId), isNull(billing.organizationId)))
      .limit(1);
    if (!record) throw new Error("Unable to create personal billing record");
    return record;
  });
}

async function syncSubscription(ctx: ProtectedContext, userId: string) {
  const billingRecord = await ensureBillingRecord(ctx, userId);

  const subscriptions = await listCustomerSubscriptions(billingRecord.stripeCustomerId, [
    "data.default_payment_method",
  ]);

  const bestSub = pickLicensedSubscription(subscriptions, (status) =>
    ACTIVE_SUB_STATUSES.has(status),
  );

  if (!bestSub) {
    // No subscription exists in Stripe, so a row that still claims one is stale.
    if (billingRecord.stripeSubscriptionId && billingRecord.mode === "subscription") {
      const [cleared] = await ctx.db
        .update(billing)
        .set({
          stripeSubscriptionId: null,
          status: "inactive",
          cancelAt: null,
          currentPeriodEnd: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(billing.userId, userId),
            isNull(billing.organizationId),
            unchangedBillingSnapshot(billingRecord),
          ),
        )
        .returning();
      return cleared ?? (await ensureBillingRecord(ctx, userId));
    }
    return billingRecord;
  }

  const subscription = await stripe.subscriptions.retrieve(bestSub.id);
  const updates: Partial<BillingRecord> = {};

  if (subscription) {
    const price = getLicensedPrice(subscription) ?? subscription.items.data.at(0)?.price ?? null;
    // The billed price is authoritative; metadata is not updated by portal plan changes.
    const plan = getPlanFromPrice(price) ?? findPlanById(subscription.metadata?.planId ?? "");
    updates.stripeSubscriptionId = subscription.id;
    updates.priceId = price?.id;
    updates.planId = plan?.id ?? billingRecord.planId;
    updates.cancelAt = subscription.cancel_at;
    // An ended subscription keeps its last period end, so "canceled" would read
    // as a grace period. Match the webhook: ended subscriptions are inactive.
    updates.status = resolveSubscriptionStatus(subscription);
    updates.mode = deriveModeFromPrice(price);
    updates.currentPeriodEnd = getSubscriptionPeriodEndDate(subscription);
  }
  if (Object.keys(updates).length === 0) {
    return billingRecord;
  }

  const [updated] = await ctx.db
    .insert(billing)
    .values({
      userId,
      stripeCustomerId: billingRecord.stripeCustomerId,
      ...updates,
    })
    .onConflictDoUpdate({
      target: billing.userId,
      targetWhere: sql`organization_id IS NULL`,
      set: {
        stripeCustomerId: billingRecord.stripeCustomerId,
        ...updates,
        updatedAt: new Date(),
      },
      setWhere: unchangedBillingSnapshot(billingRecord),
    })
    .returning();

  return updated ?? (await ensureBillingRecord(ctx, userId));
}

/**
 * Returns the stored session when it is still open for exactly this checkout:
 * same plan, price and flash offer state. Any other open session of the user is
 * expired, so a stale tab cannot still pay for another plan or an outdated price.
 */
async function reuseOpenCheckoutSession({
  checkoutSessionId,
  userId,
  planId,
  priceId,
  offerCouponId,
}: {
  checkoutSessionId: string | null | undefined;
  userId: string;
  planId: string;
  priceId: string;
  offerCouponId: string;
}) {
  if (!checkoutSessionId) {
    return null;
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(
      checkoutSessionId,
      {},
      customCheckoutRequestOptions,
    );

    if (session.status !== "open" || session.client_reference_id !== userId) {
      return null;
    }

    if (
      session.ui_mode === "elements" &&
      session.metadata?.planId === planId &&
      session.metadata?.priceId === priceId &&
      session.metadata?.flashOfferCoupon === offerCouponId &&
      session.client_secret
    ) {
      return session;
    }

    await stripe.checkout.sessions
      .expire(session.id, {}, customCheckoutRequestOptions)
      .catch((error) => console.warn("Failed to expire stale checkout session", error));
    return null;
  } catch (error) {
    console.warn("Failed to reuse checkout session", error);
    return null;
  }
}

export const billingRouter = router({
  // Every call reads Stripe, and batched requests fan out per call. Only the
  // delete dialog fetches it, once per open, hence the tighter budget.
  accountDeletionStatus: protectedProcedure
    .use(stripeRead("accountDeletionStatus", { windowMs: 60_000, maxRequests: 10 }))
    .query(async ({ ctx }) => getAccountDeletionStatus(ctx.userId)),
  plans: billingEnabledProcedure.use(stripeRead("plans")).query(async ({ ctx }) => {
    const individualPlans = billingPlans.filter((p) => !isTeamPlan(p.id));
    const billingRecord = await ensureBillingRecord(ctx, ctx.userId);
    const [flashOffer, prices] = await Promise.all([
      resolveFlashOffer(billingRecord),
      getPricesForPlans(individualPlans),
    ]);
    const plans = individualPlans.map((plan, index) => {
      const price = prices[index];
      const mode = deriveModeFromPrice(price);
      const discountedAmount =
        flashOffer && isFlashOfferPlan(plan.id)
          ? applyCouponToAmount(price.unit_amount, flashOffer.coupon, price.currency)
          : price.unit_amount;
      return {
        id: plan.id,
        lookupKey: plan.lookupKey,
        mode,
        priceId: price.id,
        amount: discountedAmount,
        originalAmount: discountedAmount !== price.unit_amount ? price.unit_amount : null,
        currency: price.currency,
        interval: price.recurring?.interval ?? null,
        intervalCount: price.recurring?.interval_count ?? 1,
        isTeamPlan: false,
        // Only advertise the offer when the coupon actually lowers this price.
        limitedTimeOffer:
          flashOffer && discountedAmount !== price.unit_amount ? flashOffer.limit : null,
      };
    });

    return { plans };
  }),
  /**
   * App-wide flash offer promo for users who have never paid: every such user
   * while spots are open, else card-verified users with a running timer.
   * Read-only: unlike `plans`, it never creates a billing record or starts the timer.
   */
  flashOffer: protectedProcedure.use(stripeRead("flashOffer")).query(async ({ ctx }) => {
    if (isBillingDisabled || ctx.session?.user?.isAnonymous) return null;

    const [record] = await ctx.db
      .select({
        cardVerifiedAt: billing.cardVerifiedAt,
        firstPaidAt: billing.firstPaidAt,
        flashOfferEndsAt: billing.flashOfferEndsAt,
        status: billing.status,
      })
      .from(billing)
      .where(and(eq(billing.userId, ctx.userId), isNull(billing.organizationId)))
      .limit(1);
    if (record?.firstPaidAt || ACTIVE_SUB_STATUSES.has(record?.status ?? "")) return null;
    const limit = getFlashOfferLimit(record, 0);
    // Timer offers are only advertised app-wide after card verification.
    if (!limit || (limit.kind === "timer" && !record?.cardVerifiedAt)) return null;

    const [teamRecord] = await ctx.db
      .select({ id: billing.id })
      .from(billing)
      .innerJoin(member, eq(billing.organizationId, member.organizationId))
      .where(
        and(
          eq(member.userId, ctx.userId),
          isNotNull(billing.organizationId),
          inArray(billing.status, [...ACTIVE_SUB_STATUSES]),
        ),
      )
      .limit(1);
    if (teamRecord) return null;

    const offer = await resolveFlashOffer(record);
    if (!offer) return null;
    const offerPlans = billingPlans.filter((p) => !isTeamPlan(p.id) && isFlashOfferPlan(p.id));
    const prices = await getPricesForPlans(offerPlans);
    const percents = prices
      .map((price) => {
        const amount = applyCouponToAmount(price.unit_amount, offer.coupon, price.currency);
        return amount != null && price.unit_amount
          ? Math.round((1 - amount / price.unit_amount) * 100)
          : 0;
      })
      .filter((percent) => percent > 0);
    if (percents.length === 0) return null;

    const percentOff = Math.max(...percents);
    return {
      ...offer.limit,
      percentOff,
      isUpTo: Math.min(...percents) !== percentOff,
    };
  }),
  status: billingEnabledProcedure.use(stripeRead("status")).query(async ({ ctx }) => {
    const [subscription, teamRecords] = await Promise.all([
      syncSubscription(ctx, ctx.userId),
      ctx.db
        .select({
          planId: billing.planId,
          status: billing.status,
          cancelAt: billing.cancelAt,
          mode: billing.mode,
          priceId: billing.priceId,
          currentPeriodEnd: billing.currentPeriodEnd,
          stripeCustomerId: billing.stripeCustomerId,
        })
        .from(billing)
        .innerJoin(member, eq(billing.organizationId, member.organizationId))
        .where(
          and(
            eq(member.userId, ctx.userId),
            isNotNull(billing.organizationId),
            like(billing.planId, "pro_team%"),
          ),
        ),
    ]);

    const now = new Date();
    const teamRecord = teamRecords.find((candidate) => {
      const teamActive =
        candidate.planId && candidate.status && ACTIVE_SUB_STATUSES.has(candidate.status);
      const teamGrace =
        candidate.status === "canceled" &&
        candidate.currentPeriodEnd &&
        candidate.currentPeriodEnd > now;

      return teamActive || teamGrace;
    });

    if (teamRecord) {
      return {
        planId: teamRecord.planId ?? null,
        status: teamRecord.status ?? null,
        mode: (teamRecord.mode as "subscription" | "payment" | null) ?? null,
        cancelAt: teamRecord.cancelAt,
        priceId: teamRecord.priceId ?? null,
        currentPeriodEnd: teamRecord.currentPeriodEnd ?? null,
        stripeCustomerId: teamRecord.stripeCustomerId,
        isTeamPlan: true,
      };
    }

    return {
      planId: subscription.planId ?? null,
      status: subscription.status ?? null,
      mode: subscription.mode ?? null,
      cancelAt: subscription.cancelAt,
      priceId: subscription.priceId ?? null,
      currentPeriodEnd: subscription.currentPeriodEnd ?? null,
      stripeCustomerId: subscription.stripeCustomerId,
      isTeamPlan: false,
    };
  }),
  createCheckoutSession: billingEnabledProcedure
    .use(stripeWrite("createCheckoutSession"))
    .input(
      z.object({
        planId: planIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = findPlanById(input.planId);
      if (!plan) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unknown plan.",
        });
      }

      await syncSubscription(ctx, ctx.userId);

      const billingRecord = await ensureBillingRecord(ctx, ctx.userId);

      const price = await getPriceForPlan(plan);
      const mode = deriveModeFromPrice(price);
      const flashOffer = isFlashOfferPlan(plan.id) ? await resolveFlashOffer(billingRecord) : null;
      // Recorded on the session so a reused session always matches the current offer.
      const offerCouponId = flashOffer ? flashOffer.coupon.id : "none";

      // Guards run before any reuse: a stored open session must not outlive them.
      // Ended subscriptions keep `cancel_at_period_end`, so they are skipped.
      const planSubscriptions = (
        await listCustomerSubscriptions(billingRecord.stripeCustomerId)
      ).filter(
        (sub) =>
          !isMaxModeOnlySubscription(sub) &&
          sub.status !== "canceled" &&
          sub.status !== "incomplete_expired",
      );

      // Every plan is a subscription; a one-time price in Stripe is a misconfiguration.
      if (mode !== "subscription") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown plan." });
      }
      const activeSub = planSubscriptions.find(
        (sub) => ACTIVE_SUB_STATUSES.has(sub.status) || sub.cancel_at_period_end === true,
      );

      if (activeSub) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You already have an active subscription. Use Change plan or cancel first.",
        });
      }

      const reusableSession = await reuseOpenCheckoutSession({
        checkoutSessionId: billingRecord.checkoutSessionId,
        userId: ctx.userId,
        planId: plan.id,
        priceId: price.id,
        offerCouponId,
      });

      if (reusableSession) {
        return {
          sessionId: reusableSession.id,
          clientSecret: reusableSession.client_secret,
        };
      }

      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          ui_mode: "elements",
          customer: billingRecord.stripeCustomerId,
          client_reference_id: ctx.userId,
          adaptive_pricing: {
            enabled: true,
          },
          line_items: [
            {
              price: price.id,
              quantity: 1,
            },
          ],
          metadata: {
            userId: ctx.userId,
            planId: plan.id,
            priceId: price.id,
            flashOfferCoupon: offerCouponId,
          },
          subscription_data: {
            metadata: {
              userId: ctx.userId,
              planId: plan.id,
            },
          },
          discounts: flashOffer ? [{ coupon: flashOffer.coupon.id }] : undefined,
          payment_method_options: checkoutCardPaymentMethodOptions,
          allow_promotion_codes: flashOffer ? undefined : true,
          return_url: `${new URL(env.NEXT_PUBLIC_BETTER_AUTH_URL).origin}/settings/billing/checkout/{CHECKOUT_SESSION_ID}`,
        },
        customCheckoutRequestOptions,
      );

      // Only remember the session for reuse. The plan changes once Stripe confirms
      // payment; marking the row "pending" here would revoke current access as soon
      // as the user merely opened checkout.
      await ctx.db
        .update(billing)
        .set({ checkoutSessionId: session.id, updatedAt: new Date() })
        .where(and(eq(billing.userId, ctx.userId), isNull(billing.organizationId)));

      if (!session.client_secret) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stripe did not return a checkout client secret.",
        });
      }

      return { sessionId: session.id, clientSecret: session.client_secret };
    }),
  // Read-only receipt. Purchases are recorded only by the Stripe webhook and the
  // live-subscription sync, never from a client-supplied (replayable) session id.
  getCheckoutSession: billingEnabledProcedure
    .use(stripeRead("getCheckoutSession"))
    .input(
      z.object({
        sessionId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const session = await stripe.checkout.sessions.retrieve(
        input.sessionId,
        { expand: [...checkoutSessionExpand] },
        customCheckoutRequestOptions,
      );

      if (!session.client_reference_id || session.client_reference_id !== ctx.userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Session does not belong to the current user.",
        });
      }

      return summarizeCheckoutSession(session);
    }),
  createPortalSession: billingEnabledProcedure
    .use(stripeWrite("createPortalSession"))
    .mutation(async ({ ctx }) => {
      const subscription = await syncSubscription(ctx, ctx.userId);

      const portal = await createBillingPortalSession(
        subscription.stripeCustomerId,
        "/settings/billing",
      );

      return { url: portal.url };
    }),
  changePlan: billingEnabledProcedure
    .use(stripeWrite("changePlan"))
    .input(
      z.object({
        planId: planIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = findPlanById(input.planId);
      if (!plan) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target plan must be a subscription plan.",
        });
      }

      const price = await getPriceForPlan(plan);
      const mode = deriveModeFromPrice(price);
      if (mode !== "subscription") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target plan must be a subscription plan.",
        });
      }

      const subscriptionState = await syncSubscription(ctx, ctx.userId);
      if (!subscriptionState.stripeSubscriptionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active subscription found. Start with checkout instead.",
        });
      }

      const subscription = await stripe.subscriptions.retrieve(
        subscriptionState.stripeSubscriptionId,
        { expand: ["items"] },
      );

      const item = getLicensedSubscriptionItem(subscription) ?? subscription.items.data.at(0);
      if (!item?.id || isMeteredMaxModePrice(item.price)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Subscription has no billable items to update.",
        });
      }

      const updated = await stripe.subscriptions.update(subscription.id, {
        items: [{ id: item.id, price: price.id }],
        metadata: { userId: ctx.userId, planId: plan.id },
        proration_behavior: "always_invoice",
        payment_behavior: "error_if_incomplete",
      });

      const updates: Partial<BillingRecord> = {
        planId: plan.id,
        priceId: price.id,
        mode,
        status: updated.cancel_at_period_end ? "canceled" : updated.status,
        currentPeriodEnd: getSubscriptionPeriodEndDate(updated),
        stripeSubscriptionId: updated.id,
      };

      const [savedSnapshot] = await ctx.db
        .insert(billing)
        .values({
          userId: ctx.userId,
          stripeCustomerId: subscription.customer as string,
          ...updates,
        })
        .onConflictDoUpdate({
          target: billing.userId,
          targetWhere: sql`organization_id IS NULL`,
          set: {
            ...updates,
            updatedAt: new Date(),
          },
          setWhere: unchangedBillingSnapshot(subscriptionState),
        })
        .returning();
      const saved = savedSnapshot ?? (await ensureBillingRecord(ctx, ctx.userId));

      return {
        planId: saved.planId ?? null,
        status: saved.status ?? null,
        mode: saved.mode ?? null,
        currentPeriodEnd: saved.currentPeriodEnd ?? null,
      };
    }),
  cancelSubscription: billingEnabledProcedure
    .use(stripeWrite("cancelSubscription"))
    .mutation(async ({ ctx }) => {
      const subscriptionState = await syncSubscription(ctx, ctx.userId);
      if (!subscriptionState.stripeSubscriptionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active subscription to cancel.",
        });
      }

      const canceled = await stripe.subscriptions.update(subscriptionState.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      const updates: Partial<BillingRecord> = {
        status: canceled.cancel_at_period_end ? "canceled" : canceled.status,
        currentPeriodEnd:
          getSubscriptionPeriodEndDate(canceled) ?? subscriptionState.currentPeriodEnd,
      };

      const [savedSnapshot] = await ctx.db
        .insert(billing)
        .values({
          userId: ctx.userId,
          stripeCustomerId: subscriptionState.stripeCustomerId,
          stripeSubscriptionId: subscriptionState.stripeSubscriptionId,
          ...updates,
        })
        .onConflictDoUpdate({
          target: billing.userId,
          targetWhere: sql`organization_id IS NULL`,
          set: {
            ...updates,
            updatedAt: new Date(),
          },
          setWhere: unchangedBillingSnapshot(subscriptionState),
        })
        .returning();
      const saved = savedSnapshot ?? (await ensureBillingRecord(ctx, ctx.userId));

      return {
        planId: saved.planId ?? null,
        status: saved.status ?? null,
        mode: saved.mode ?? null,
        currentPeriodEnd: saved.currentPeriodEnd ?? null,
      };
    }),
  resumeSubscription: billingEnabledProcedure
    .use(stripeWrite("resumeSubscription"))
    .mutation(async ({ ctx }) => {
      const subscriptionState = await syncSubscription(ctx, ctx.userId);
      if (!subscriptionState.stripeSubscriptionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No subscription to resume.",
        });
      }

      const resumed = await stripe.subscriptions.update(subscriptionState.stripeSubscriptionId, {
        cancel_at_period_end: false,
      });

      const price = getLicensedPrice(resumed) ?? resumed.items.data.at(0)?.price ?? null;
      const plan =
        getPlanFromPrice(price) ??
        findPlanById(resumed.metadata?.planId ?? "") ??
        (subscriptionState.planId ? findPlanById(subscriptionState.planId) : null);

      const updates: Partial<BillingRecord> = {
        status: resumed.status,
        currentPeriodEnd: getSubscriptionPeriodEndDate(resumed),
        stripeSubscriptionId: resumed.id,
        priceId: price?.id ?? subscriptionState.priceId,
        planId: plan?.id ?? subscriptionState.planId,
        mode: deriveModeFromPrice(price),
      };

      const [savedSnapshot] = await ctx.db
        .insert(billing)
        .values({
          userId: ctx.userId,
          stripeCustomerId: subscriptionState.stripeCustomerId,
          ...updates,
        })
        .onConflictDoUpdate({
          target: billing.userId,
          targetWhere: sql`organization_id IS NULL`,
          set: {
            ...updates,
            updatedAt: new Date(),
          },
          setWhere: unchangedBillingSnapshot(subscriptionState),
        })
        .returning();
      const saved = savedSnapshot ?? (await ensureBillingRecord(ctx, ctx.userId));

      return {
        planId: saved.planId ?? null,
        status: saved.status ?? null,
        mode: saved.mode ?? null,
        currentPeriodEnd: saved.currentPeriodEnd ?? null,
      };
    }),
  usage: protectedProcedure.query(async ({ ctx }) => {
    const summary = await getUsageSummary({
      userId: ctx.userId,
      isAnonymous: Boolean(ctx.session?.user?.isAnonymous),
    });
    return summary;
  }),
  estimatePlanChange: billingEnabledProcedure
    .use(stripeRead("estimatePlanChange"))
    .input(
      z.object({
        planId: planIdSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const plan = findPlanById(input.planId);
      if (!plan) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target plan must be a subscription plan.",
        });
      }

      const price = await getPriceForPlan(plan);
      const mode = deriveModeFromPrice(price);
      if (mode !== "subscription") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target plan must be a subscription plan.",
        });
      }

      const subscriptionState = await syncSubscription(ctx, ctx.userId);

      if (!subscriptionState.stripeSubscriptionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active subscription to estimate against.",
        });
      }

      const subscription = await stripe.subscriptions.retrieve(
        subscriptionState.stripeSubscriptionId,
        { expand: ["items"] },
      );
      const item = getLicensedSubscriptionItem(subscription) ?? subscription.items.data.at(0);
      if (!item?.id || isMeteredMaxModePrice(item.price)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Subscription has no billable items to estimate.",
        });
      }

      if (item.price?.id === price.id) {
        return {
          amountDue: 0,
          currency: item.price?.currency ?? subscription.currency ?? null,
        };
      }

      const upcoming = await stripe.invoices.createPreview({
        customer: subscription.customer as string,
        subscription: subscription.id,
        subscription_details: {
          items: [
            {
              id: item.id,
              price: price.id,
            },
          ],
          proration_behavior: "always_invoice",
        },
      });

      return {
        amountDue: upcoming.amount_due ?? 0,
        currency: upcoming.currency ?? item.price?.currency ?? null,
        nextPaymentAttempt: upcoming.next_payment_attempt
          ? new Date(upcoming.next_payment_attempt * 1000)
          : null,
      };
    }),
  // Max Mode endpoints: prepaid credits spent once the plan's pool is used up.
  // Reads every credit lot of the owner; the team Max Mode editor refetches it per edit.
  maxModeStatus: protectedProcedure
    .use(stripeRead("maxModeStatus", TRPC_RATE_LIMITS.stripeReadPerEdit))
    .query(async ({ ctx }) => getMaxModeStatus(ctx.userId)),
  createMaxModeCreditCheckout: billingEnabledProcedure
    .use(stripeWrite("createMaxModeCreditCheckout"))
    .input(
      z.object({
        credits: z.number().int().min(MAX_MODE_CREDIT_MIN).max(MAX_MODE_CREDIT_MAX),
        saveCard: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const target = await getMaxModeCreditTarget(ctx.userId);
      if (!target.ok) throw new TRPCError({ code: "BAD_REQUEST", message: target.error });
      const url = await createMaxModeCreditCheckout({
        owner: target.owner,
        credits: input.credits,
        stripeCustomerId: target.stripeCustomerId,
        purchasedByUserId: ctx.userId,
        saveCard: input.saveCard,
        returnPath: target.returnPath,
      });
      return { url };
    }),
  updateMaxModeAutoTopUp: billingEnabledProcedure
    .use(stripeWrite("updateMaxModeAutoTopUp"))
    .input(
      z.object({
        enabled: z.boolean(),
        thresholdCredits: z
          .number()
          .int()
          .min(MAX_MODE_AUTO_TOP_UP_THRESHOLD_MIN)
          .max(MAX_MODE_AUTO_TOP_UP_THRESHOLD_MAX),
        amountCredits: z.number().int().min(MAX_MODE_CREDIT_MIN).max(MAX_MODE_CREDIT_MAX),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const target = await getMaxModeCreditTarget(ctx.userId);
      if (!target.ok) throw new TRPCError({ code: "BAD_REQUEST", message: target.error });
      const result = await updateMaxModeAutoTopUp(target.owner, input);
      if (!result.success) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      return { success: true };
    }),
  enableMaxMode: billingEnabledProcedure
    .use(stripeWrite("enableMaxMode"))
    .mutation(async ({ ctx }) => {
      const result = await enableMaxMode(ctx.userId);
      if (!result.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error ?? "Failed to enable Max Mode.",
        });
      }
      return { success: true };
    }),
  disableMaxMode: billingEnabledProcedure.mutation(async ({ ctx }) => {
    const result = await disableMaxMode(ctx.userId);
    if (!result.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: result.error ?? "Failed to disable Max Mode.",
      });
    }
    return { success: true };
  }),
  // ---- Free-tier card verification (manual-capture auth, then cancel) ----
  createCardSetupIntent: billingEnabledProcedure
    .use(stripeWrite("createCardSetupIntent", TRPC_RATE_LIMITS.cardVerification))
    .mutation(async ({ ctx }) => {
      const billingRecord = await ensureBillingRecord(ctx, ctx.userId);
      // Reopening the dialog continues the intent it left waiting for a card
      // (a declined card leaves it there too) instead of opening another one.
      const open = await findOpenCardVerificationIntent(billingRecord.stripeCustomerId, ctx.userId);
      if (open?.client_secret) {
        return { clientSecret: open.client_secret, paymentIntentId: open.id };
      }
      // $1.00 (USD has cents → amount=100) authorization. We never capture —
      // the bank auth itself is the verification, and we cancel immediately to
      // release the hold.
      const intent = await stripe.paymentIntents.create({
        customer: billingRecord.stripeCustomerId,
        amount: CARD_VERIFICATION_AMOUNT,
        currency: "usd",
        allowed_payment_method_types: ["card"],
        capture_method: "manual",
        setup_future_usage: "off_session",
        description: "Card verification (released immediately, never charged)",
        payment_method_options: {
          card: {
            request_three_d_secure: requestThreeDSecure,
          },
        },
        metadata: {
          userId: ctx.userId,
          purpose: "free_tier_verification",
        },
      });
      if (!intent.client_secret) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stripe did not return a client secret for the verification intent.",
        });
      }
      return {
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
      };
    }),
  confirmCardSetup: billingEnabledProcedure
    .use(stripeWrite("confirmCardSetup", TRPC_RATE_LIMITS.cardVerification))
    .input(z.object({ paymentIntentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const billingRecord = await ensureBillingRecord(ctx, ctx.userId);
      const intent = await stripe.paymentIntents.retrieve(input.paymentIntentId, {
        expand: ["payment_method"],
      });

      const intentCustomerId =
        typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
      if (
        intent.metadata?.userId !== ctx.userId ||
        intent.metadata?.purpose !== "free_tier_verification" ||
        intentCustomerId !== billingRecord.stripeCustomerId
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Verification intent does not belong to you.",
        });
      }
      // Manual capture: a successful auth lands the PI in `requires_capture`.
      // `succeeded` would mean it was somehow captured (shouldn't happen here).
      if (intent.status !== "requires_capture" && intent.status !== "succeeded") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Verification not yet authorized (status: ${intent.status}).`,
        });
      }

      const paymentMethod = intent.payment_method;
      const pm =
        typeof paymentMethod === "string"
          ? await stripe.paymentMethods.retrieve(paymentMethod)
          : paymentMethod;
      if (!pm || pm.type !== "card" || !pm.card?.fingerprint) {
        // Release the hold before erroring out.
        if (intent.status === "requires_capture") {
          await stripe.paymentIntents.cancel(intent.id).catch(() => {});
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only card payment methods are supported.",
        });
      }

      const fingerprint = pm.card.fingerprint;
      const funding: CardFunding =
        pm.card.funding === "credit" || pm.card.funding === "debit" || pm.card.funding === "prepaid"
          ? pm.card.funding
          : "unknown";

      const eligibility = await claimCardVerification(ctx.db, {
        fingerprint,
        funding,
        userId: ctx.userId,
        customerId: billingRecord.stripeCustomerId,
      });
      if (!eligibility.eligible) {
        // Always release the $1 USD hold first.
        if (intent.status === "requires_capture") {
          await stripe.paymentIntents.cancel(intent.id).catch((err) => {
            console.warn("[billing] Failed to cancel rejected verification PI", err);
          });
        }
        try {
          await stripe.paymentMethods.detach(pm.id);
        } catch (err) {
          console.warn("[billing] Failed to detach rejected payment method", err);
        }
        // Don't leak the limit policy — surface a generic decline. Log the
        // real reason server-side for support.
        console.info("[billing] Card verification declined by eligibility policy", {
          userId: ctx.userId,
          reason: eligibility.reason,
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Your card was declined. Please try a different card.",
        });
      }

      // Auth passed and eligibility passed — release the $1 USD hold now.
      if (intent.status === "requires_capture") {
        await stripe.paymentIntents.cancel(intent.id).catch((err) => {
          console.warn("[billing] Failed to cancel verification PI after success", err);
        });
      }

      // Ensure it's also attached + set as default for future invoices.
      try {
        await stripe.customers.update(billingRecord.stripeCustomerId, {
          invoice_settings: { default_payment_method: pm.id },
        });
      } catch (err) {
        console.warn("[billing] Failed to set default payment method", err);
      }

      // Card holders can pay right away: give them a one-time flash offer.
      await grantCardVerificationFlashOffer(ctx.db, ctx.userId).catch((err) => {
        console.warn("[billing] Failed to grant card verification flash offer", err);
      });

      const saved = eligibility.record;

      return {
        verified: true,
        funding,
        cardVerifiedAt: saved?.cardVerifiedAt?.toISOString() ?? null,
      };
    }),
  removeVerifiedCard: billingEnabledProcedure
    .use(stripeWrite("removeVerifiedCard"))
    .mutation(async ({ ctx }) => {
      const billingRecord = await ensureBillingRecord(ctx, ctx.userId);
      // Ask Stripe, not the row: a subscription canceling at period end (stored as
      // "canceled"), the Max Mode meter host and open invoices still bill the card.
      const blocker = await getCardRemovalBlocker(billingRecord.stripeCustomerId);
      if (blocker === "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cancel your subscription before removing the card.",
        });
      }
      if (blocker === "billingPending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Wait for your subscription to end and pay outstanding invoices before removing the card.",
        });
      }
      try {
        const paymentMethods = await stripe.customers.listPaymentMethods(
          billingRecord.stripeCustomerId,
          { type: "card", limit: 10 },
        );
        await Promise.all(
          paymentMethods.data.map((pm) =>
            stripe.paymentMethods.detach(pm.id).catch((err) => {
              console.warn("[billing] Failed to detach payment method", err);
            }),
          ),
        );
      } catch (err) {
        console.warn("[billing] Failed to list payment methods on removal", err);
      }
      await ctx.db
        .update(billing)
        .set({
          // Keep the fingerprint: removing a card must not free its reuse slot.
          cardVerifiedAt: null,
          cardRemovedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(billing.userId, ctx.userId), isNull(billing.organizationId)));
      return { removed: true };
    }),
});
