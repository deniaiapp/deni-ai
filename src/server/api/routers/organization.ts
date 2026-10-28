import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  billing,
  invitation,
  member,
  teamMemberUsagePolicy,
  teamUsageAuditLog,
  teamUsagePolicy,
  usageQuota,
  user,
} from "@/db/schema";
import { env } from "@/env";
import { type BillingPlan, billingPlans, findPlanById, isTeamPlan } from "@/lib/billing";
import { isBillingDisabled } from "@/lib/billing-config";
import { planDisplayCurrency, priceInCurrency } from "@/lib/plan-currency";
import { escapeStripeSearchValue } from "@/lib/stripe-search";
import { stripe } from "@/lib/stripe";
import { createBillingPortalSession } from "@/lib/stripe-portal";
import {
  checkoutCardPaymentMethodOptions,
  customCheckoutRequestOptions,
} from "@/lib/stripe-checkout";
import { checkoutSessionExpand, summarizeCheckoutSession } from "@/lib/stripe-checkout-receipt";
import {
  createMaxModeCreditCheckout,
  getMaxModeCreditSummary,
  MAX_MODE_AUTO_TOP_UP_THRESHOLD_MAX,
  MAX_MODE_AUTO_TOP_UP_THRESHOLD_MIN,
  MAX_MODE_CREDIT_MAX,
  MAX_MODE_CREDIT_MIN,
  MAX_MODE_CREDIT_PACKS,
  updateMaxModeAutoTopUp,
} from "@/lib/max-mode-credits";
import {
  listCustomerSubscriptions,
  getLicensedPrice,
  getLicensedSubscriptionItem,
  getSubscriptionPeriodEndDate,
  isMaxModeOnlySubscription,
  isMeteredMaxModePrice,
  pickLicensedSubscription,
} from "@/lib/stripe-subscriptions";
import { getOrgMemberCount, updateTeamSeatCount } from "@/lib/team-billing";
import {
  findTeamBillingRecord,
  saveTeamBillingRecord,
  withTeamBillingLock,
} from "@/lib/team-billing-record";
import { getUsagePoolUnits } from "@/lib/usage";
import {
  type ProtectedContext,
  protectedProcedure,
  rateLimited,
  router,
  TRPC_RATE_LIMITS,
  type TRPCRateLimit,
} from "../trpc";
import { historyBefore, historyCursorSchema, historyCursorTimestamp } from "../history-pagination";

import type Stripe from "stripe";

const teamPlanIdSchema = z.enum(["pro_team_monthly", "pro_team_yearly"]);
const maxModeLimitSchema = z.number().int().min(0).nullable();

type BillingRecord = typeof billing.$inferSelect;

const ACTIVE_SUB_STATUSES = new Set(["trialing", "active", "past_due"]);

const billingEnabledProcedure = protectedProcedure.use(({ ctx, next }) => {
  // Guest sessions must not reach team billing, matching billing.ts; guests
  // can no longer create teams, but older guest-owned teams may still exist.
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
  rateLimited(`organization.${name}`, limit);

/** Per-user budget for a mutation that calls Stripe. */
const stripeWrite = (name: string) =>
  rateLimited(`organization.${name}`, TRPC_RATE_LIMITS.stripeWrite);

function deriveModeFromPrice(price: Stripe.Price | null | undefined): "subscription" | "payment" {
  if (!price) {
    return "subscription";
  }
  return price.recurring ? "subscription" : "payment";
}

async function findPriceForPlan(plan: BillingPlan, expand?: string[]) {
  const prices = await stripe.prices.list({
    lookup_keys: [plan.lookupKey],
    active: true,
    limit: 1,
    ...(expand ? { expand } : {}),
  });
  return prices.data.at(0) ?? null;
}

async function getPriceForPlan(plan: BillingPlan) {
  const price = await findPriceForPlan(plan);
  if (!price) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unable to load ${plan.lookupKey} price. Configure lookup_key=${plan.lookupKey} in Stripe.`,
    });
  }

  return price;
}

async function verifyOrgOwner(ctx: ProtectedContext, organizationId: string) {
  const [memberRecord] = await ctx.db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, ctx.userId)))
    .limit(1);

  if (!memberRecord || memberRecord.role !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only organization owners can manage team billing.",
    });
  }
}

// Same as verifyOrgOwner, but also allows the "admin" role for non-financial
// settings (Max Mode policy, audit log viewing, cancel/resume of an existing
// subscription). Purchasing, changing plans, and the Stripe billing portal
// stay owner-only via verifyOrgOwner.
async function verifyOrgOwnerOrAdmin(ctx: ProtectedContext, organizationId: string) {
  const [memberRecord] = await ctx.db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, ctx.userId)))
    .limit(1);

  if (!memberRecord || (memberRecord.role !== "owner" && memberRecord.role !== "admin")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only organization owners or admins can manage this.",
    });
  }
}

async function getOwnedTeamBillingRecord(ctx: ProtectedContext, organizationId: string) {
  await verifyOrgOwnerOrAdmin(ctx, organizationId);
  const subscription = await syncTeamSubscription(ctx, ctx.userId, organizationId);
  if (!subscription.planId || !isTeamPlan(subscription.planId)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "An active team subscription is required to manage Max Mode.",
    });
  }

  if (subscription.status !== "active") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Max Mode requires an active team subscription.",
    });
  }

  return subscription;
}

async function ensureTeamUsagePolicy(ctx: ProtectedContext, organizationId: string) {
  const [policy] = await ctx.db
    .insert(teamUsagePolicy)
    .values({ organizationId })
    .onConflictDoNothing({ target: teamUsagePolicy.organizationId })
    .returning();

  if (policy) {
    return policy;
  }

  const [existing] = await ctx.db
    .select()
    .from(teamUsagePolicy)
    .where(eq(teamUsagePolicy.organizationId, organizationId))
    .limit(1);

  if (!existing) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unable to load team usage policy.",
    });
  }

  return existing;
}

async function recordTeamUsageAuditLog({
  ctx,
  organizationId,
  action,
  targetUserId,
  metadata,
}: {
  ctx: ProtectedContext;
  organizationId: string;
  action: string;
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await ctx.db.insert(teamUsageAuditLog).values({
    organizationId,
    actorUserId: ctx.userId,
    targetUserId: targetUserId ?? null,
    action,
    metadata,
  });
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
  organizationId,
}: {
  email: string;
  name?: string | null;
  userId: string;
  organizationId: string;
}) {
  // A search failure must not mint a second customer for an existing team.
  const search = await stripe.customers.search({
    query: `metadata['organizationId']:'${escapeStripeSearchValue(organizationId)}'`,
    limit: 1,
  });
  const customer = search.data[0];
  if (customer) return customer;

  return stripe.customers.create(
    {
      email,
      name: name ? `${name} (Team)` : undefined,
      metadata: { userId, organizationId },
    },
    { idempotencyKey: `billing-team-${organizationId}` },
  );
}

async function ensureTeamBillingRecord(
  ctx: ProtectedContext,
  userId: string,
  organizationId: string,
) {
  const initial = await findTeamBillingRecord(ctx.db, organizationId);
  if (initial) return initial;
  const profile = await fetchUserProfile(ctx, userId);
  const customer = await findOrCreateStripeCustomer({
    email: profile.email,
    name: profile.name,
    userId,
    organizationId,
  });
  // Stripe I/O and profile reads finish before acquiring a pooled transaction.
  // The organization idempotency key deduplicates concurrent Stripe creations.
  return withTeamBillingLock(ctx.db, organizationId, async (transaction) => {
    const existing = await findTeamBillingRecord(transaction, organizationId);
    if (existing) return existing;
    const [created] = await transaction
      .insert(billing)
      .values({
        userId,
        organizationId,
        stripeCustomerId: customer.id,
        status: "inactive",
      })
      .returning();
    if (!created) throw new Error("Unable to create team billing record.");
    return created;
  });
}

async function saveTeamSubscriptionSnapshot(
  ctx: ProtectedContext,
  snapshot: BillingRecord,
  updates: Partial<BillingRecord> & { stripeCustomerId: string },
) {
  const saved = await saveTeamBillingRecord(
    ctx.db,
    snapshot.userId,
    snapshot.organizationId!,
    updates,
    snapshot.stripeSubscriptionId,
    snapshot,
  );
  return saved ?? (await findTeamBillingRecord(ctx.db, snapshot.organizationId!)) ?? snapshot;
}

async function syncTeamSubscription(ctx: ProtectedContext, userId: string, organizationId: string) {
  const billingRecord = await ensureTeamBillingRecord(ctx, userId, organizationId);

  const subscriptions = await listCustomerSubscriptions(billingRecord.stripeCustomerId, [
    "data.default_payment_method",
  ]);

  const bestSub = pickLicensedSubscription(subscriptions, (status) =>
    ACTIVE_SUB_STATUSES.has(status),
  );
  const subscriptionId = bestSub?.id;
  if (!subscriptionId) {
    return saveTeamSubscriptionSnapshot(ctx, billingRecord, {
      stripeCustomerId: billingRecord.stripeCustomerId,
      stripeSubscriptionId: null,
      planId: null,
      priceId: null,
      status: "inactive",
      currentPeriodEnd: null,
      cancelAt: null,
    });
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const updates: Partial<BillingRecord> = {};

  if (subscription) {
    const price = getLicensedPrice(subscription) ?? subscription.items.data.at(0)?.price ?? null;
    // The billed price is authoritative; metadata is not updated by portal plan changes.
    const plan =
      billingPlans.find((p) => p.lookupKey === price?.lookup_key) ??
      findPlanById(subscription.metadata?.planId ?? "");
    const status = subscription.status;

    updates.stripeSubscriptionId = subscription.id;
    updates.priceId = price?.id;
    updates.planId = plan?.id ?? billingRecord.planId;
    updates.cancelAt = subscription.cancel_at;
    updates.status =
      status === "canceled"
        ? "inactive"
        : subscription.cancel_at_period_end || subscription.cancel_at
          ? "canceled"
          : status;
    updates.mode = deriveModeFromPrice(price);
    updates.currentPeriodEnd = getSubscriptionPeriodEndDate(subscription);
  }
  if (Object.keys(updates).length === 0) {
    return billingRecord;
  }

  return saveTeamSubscriptionSnapshot(ctx, billingRecord, {
    ...updates,
    stripeCustomerId: billingRecord.stripeCustomerId,
  });
}

async function reuseOpenTeamCheckoutSession({
  checkoutSessionId,
  userId,
  organizationId,
  planId,
}: {
  checkoutSessionId: string | null | undefined;
  userId: string;
  organizationId: string;
  planId: string;
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

    if (
      session.status !== "open" ||
      session.ui_mode !== "elements" ||
      session.client_reference_id !== userId ||
      session.metadata?.planId !== planId ||
      session.metadata?.organizationId !== organizationId ||
      !session.client_secret
    ) {
      return null;
    }

    return session;
  } catch (error) {
    console.warn("Failed to reuse team checkout session", error);
    return null;
  }
}

export const organizationRouter = router({
  teamPlans: billingEnabledProcedure.use(stripeRead("teamPlans")).query(async ({ ctx }) => {
    const teamPlans = billingPlans.filter((p) => isTeamPlan(p.id));
    const displayCurrency = planDisplayCurrency(ctx.country);
    const plans = (
      await Promise.all(
        teamPlans.map(async (plan) => {
          const price = await findPriceForPlan(plan, ["data.currency_options"]);
          if (!price) {
            return null;
          }
          const mode = deriveModeFromPrice(price);
          const { amount, currency } = priceInCurrency(price, displayCurrency);
          return {
            id: plan.id,
            lookupKey: plan.lookupKey,
            mode,
            priceId: price.id,
            amount,
            currency,
            interval: price.recurring?.interval ?? null,
            intervalCount: price.recurring?.interval_count ?? 1,
            isTeamPlan: true,
          };
        }),
      )
    ).filter((plan) => plan !== null);
    return { plans };
  }),

  // Accepting a team invitation cancels the invitee's personal subscription when the
  // team has a live paid plan (afterAcceptInvitation -> cancelPersonalSubscription).
  // The accept dialog asks this first so it can warn before the user joins.
  invitationBillingImpact: protectedProcedure
    .use(stripeRead("invitationBillingImpact"))
    .input(z.object({ invitationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const noImpact = { cancelsPersonalSubscription: false };
      if (isBillingDisabled) return noImpact;

      const [[invite], [profile]] = await Promise.all([
        ctx.db
          .select({
            organizationId: invitation.organizationId,
            email: invitation.email,
            status: invitation.status,
            expiresAt: invitation.expiresAt,
          })
          .from(invitation)
          .where(eq(invitation.id, input.invitationId))
          .limit(1),
        ctx.db.select({ email: user.email }).from(user).where(eq(user.id, ctx.userId)).limit(1),
      ]);
      // Only the invitee may ask, and only about an invitation they can still accept.
      if (
        !invite ||
        !profile ||
        invite.status !== "pending" ||
        invite.expiresAt < new Date() ||
        invite.email.toLowerCase() !== profile.email.toLowerCase()
      ) {
        return noImpact;
      }

      const [teamBilling, [personalBilling]] = await Promise.all([
        findTeamBillingRecord(ctx.db, invite.organizationId),
        ctx.db
          .select({ stripeSubscriptionId: billing.stripeSubscriptionId })
          .from(billing)
          .where(and(eq(billing.userId, ctx.userId), isNull(billing.organizationId)))
          .limit(1),
      ]);
      if (
        !teamBilling?.stripeSubscriptionId ||
        !isTeamPlan(teamBilling.planId) ||
        !personalBilling?.stripeSubscriptionId
      ) {
        return noImpact;
      }

      try {
        // Mirror cancelPersonalSubscription's live Stripe checks.
        const [teamSubscription, personalSubscription] = await Promise.all([
          stripe.subscriptions.retrieve(teamBilling.stripeSubscriptionId),
          stripe.subscriptions.retrieve(personalBilling.stripeSubscriptionId),
        ]);
        return {
          cancelsPersonalSubscription:
            ACTIVE_SUB_STATUSES.has(teamSubscription.status) &&
            Boolean(getLicensedSubscriptionItem(teamSubscription)) &&
            ACTIVE_SUB_STATUSES.has(personalSubscription.status),
        };
      } catch (error) {
        console.warn("Failed to check invitation billing impact", error);
        // When unsure, warn: an unneeded warning costs less than a missing one.
        return { cancelsPersonalSubscription: true };
      }
    }),

  teamBillingStatus: billingEnabledProcedure
    .use(stripeRead("teamBillingStatus"))
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await verifyOrgOwnerOrAdmin(ctx, input.organizationId);
      const [subscription, memberCount] = await Promise.all([
        syncTeamSubscription(ctx, ctx.userId, input.organizationId),
        getOrgMemberCount(input.organizationId),
      ]);
      return {
        planId: subscription.planId ?? null,
        status: subscription.status ?? null,
        mode: subscription.mode ?? null,
        cancelAt: subscription.cancelAt,
        priceId: subscription.priceId ?? null,
        currentPeriodEnd: subscription.currentPeriodEnd ?? null,
        stripeCustomerId: subscription.stripeCustomerId,
        memberCount,
      };
    }),

  // Refetched after every saved Max Mode field, so it gets the per-edit budget.
  teamMaxModeSettings: billingEnabledProcedure
    .use(stripeRead("teamMaxModeSettings", TRPC_RATE_LIMITS.stripeReadPerEdit))
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await verifyOrgOwnerOrAdmin(ctx, input.organizationId);
      const auditActorUser = alias(user, "audit_actor_user");
      const auditTargetUser = alias(user, "audit_target_user");
      const [subscription, defaultPolicy, members, auditLog, credits] = await Promise.all([
        syncTeamSubscription(ctx, ctx.userId, input.organizationId),
        ensureTeamUsagePolicy(ctx, input.organizationId),
        ctx.db
          .select({
            memberId: member.id,
            userId: member.userId,
            role: member.role,
            name: user.name,
            email: user.email,
            policyEnabled: teamMemberUsagePolicy.maxModeEnabled,
            policyLimitBasic: teamMemberUsagePolicy.maxModeLimitBasic,
            policyLimitPremium: teamMemberUsagePolicy.maxModeLimitPremium,
          })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .leftJoin(
            teamMemberUsagePolicy,
            and(
              eq(teamMemberUsagePolicy.organizationId, member.organizationId),
              eq(teamMemberUsagePolicy.userId, member.userId),
            ),
          )
          .where(eq(member.organizationId, input.organizationId)),
        ctx.db
          .select({
            id: teamUsageAuditLog.id,
            actorUserId: teamUsageAuditLog.actorUserId,
            actorName: auditActorUser.name,
            actorEmail: auditActorUser.email,
            targetUserId: teamUsageAuditLog.targetUserId,
            targetName: auditTargetUser.name,
            targetEmail: auditTargetUser.email,
            action: teamUsageAuditLog.action,
            metadata: teamUsageAuditLog.metadata,
            createdAt: teamUsageAuditLog.createdAt,
          })
          .from(teamUsageAuditLog)
          // Left join: the actor's account may have been deleted (actor_user_id is
          // then null) and the entry must still show.
          .leftJoin(auditActorUser, eq(auditActorUser.id, teamUsageAuditLog.actorUserId))
          .leftJoin(auditTargetUser, eq(auditTargetUser.id, teamUsageAuditLog.targetUserId))
          .where(eq(teamUsageAuditLog.organizationId, input.organizationId))
          .orderBy(desc(teamUsageAuditLog.createdAt))
          .limit(5),
        getMaxModeCreditSummary({ userId: null, organizationId: input.organizationId }),
      ]);

      const memberIds = members.map((m) => m.userId);
      const usageRows =
        memberIds.length > 0
          ? await ctx.db
              .select({
                userId: usageQuota.userId,
                category: usageQuota.category,
                used: usageQuota.used,
              })
              .from(usageQuota)
              .where(inArray(usageQuota.userId, memberIds))
          : [];
      const usageByMember = new Map<string, { basic: number; premium: number }>();
      const poolIncluded = getUsagePoolUnits("pro");

      for (const row of usageRows) {
        const current = usageByMember.get(row.userId) ?? { basic: 0, premium: 0 };
        if (row.category === "basic") current.basic = row.used;
        if (row.category === "premium") current.premium = row.used;
        usageByMember.set(row.userId, current);
      }
      // Both categories draw on one pool: what exceeds it is split by each one's share.
      for (const [userId, used] of usageByMember) {
        const total = used.basic + used.premium;
        const over = Math.max(total - poolIncluded, 0);
        const basicOver = total > 0 ? Math.round((over * used.basic) / total) : 0;
        usageByMember.set(userId, { basic: basicOver, premium: over - basicOver });
      }

      return {
        enabled: Boolean(subscription.maxModeEnabled),
        eligible: subscription.planId
          ? isTeamPlan(subscription.planId) && subscription.status === "active"
          : false,
        credits,
        packs: MAX_MODE_CREDIT_PACKS,
        minCredits: MAX_MODE_CREDIT_MIN,
        maxCredits: MAX_MODE_CREDIT_MAX,
        defaultPolicy: {
          maxModeEnabled: defaultPolicy.defaultMaxModeEnabled,
          maxModeLimitBasic: defaultPolicy.defaultMaxModeLimitBasic,
          maxModeLimitPremium: defaultPolicy.defaultMaxModeLimitPremium,
        },
        members: members.map((m) => {
          const maxModeUsage = usageByMember.get(m.userId) ?? { basic: 0, premium: 0 };
          return {
            memberId: m.memberId,
            userId: m.userId,
            role: m.role,
            name: m.name,
            email: m.email,
            maxModeEnabled: m.policyEnabled ?? defaultPolicy.defaultMaxModeEnabled,
            maxModeLimitBasic: m.policyLimitBasic ?? defaultPolicy.defaultMaxModeLimitBasic ?? null,
            maxModeLimitPremium:
              m.policyLimitPremium ?? defaultPolicy.defaultMaxModeLimitPremium ?? null,
            maxModeUsageBasic: maxModeUsage.basic,
            maxModeUsagePremium: maxModeUsage.premium,
          };
        }),
        auditLog,
      };
    }),

  teamAuditLog: billingEnabledProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        cursor: historyCursorSchema.nullish(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await verifyOrgOwnerOrAdmin(ctx, input.organizationId);

      const actorUser = alias(user, "actor_user");
      const targetUser = alias(user, "target_user");

      const rows = await ctx.db
        .select({
          id: teamUsageAuditLog.id,
          action: teamUsageAuditLog.action,
          metadata: teamUsageAuditLog.metadata,
          createdAt: teamUsageAuditLog.createdAt,
          cursorCreatedAt: historyCursorTimestamp(teamUsageAuditLog.createdAt),
          actorId: teamUsageAuditLog.actorUserId,
          actorName: actorUser.name,
          actorEmail: actorUser.email,
          actorImage: actorUser.image,
          targetId: teamUsageAuditLog.targetUserId,
          targetName: targetUser.name,
          targetEmail: targetUser.email,
          targetImage: targetUser.image,
        })
        .from(teamUsageAuditLog)
        // Left join keeps entries whose actor deleted their account.
        .leftJoin(actorUser, eq(actorUser.id, teamUsageAuditLog.actorUserId))
        .leftJoin(targetUser, eq(targetUser.id, teamUsageAuditLog.targetUserId))
        .where(
          and(
            eq(teamUsageAuditLog.organizationId, input.organizationId),
            historyBefore(teamUsageAuditLog, input.cursor),
          ),
        )
        .orderBy(desc(teamUsageAuditLog.createdAt), desc(teamUsageAuditLog.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? { createdAt: last.cursorCreatedAt, id: last.id } : null;
      const items = page.map(({ cursorCreatedAt, ...item }) => {
        void cursorCreatedAt;
        return item;
      });

      return { items, nextCursor };
    }),

  updateTeamMaxModeDefaultPolicy: billingEnabledProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        maxModeEnabled: z.boolean(),
        maxModeLimitBasic: maxModeLimitSchema,
        maxModeLimitPremium: maxModeLimitSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await verifyOrgOwnerOrAdmin(ctx, input.organizationId);
      const previousPolicy = await ensureTeamUsagePolicy(ctx, input.organizationId);

      await ctx.db
        .insert(teamUsagePolicy)
        .values({
          organizationId: input.organizationId,
          defaultMaxModeEnabled: input.maxModeEnabled,
          defaultMaxModeLimitBasic: input.maxModeLimitBasic,
          defaultMaxModeLimitPremium: input.maxModeLimitPremium,
        })
        .onConflictDoUpdate({
          target: teamUsagePolicy.organizationId,
          set: {
            defaultMaxModeEnabled: input.maxModeEnabled,
            defaultMaxModeLimitBasic: input.maxModeLimitBasic,
            defaultMaxModeLimitPremium: input.maxModeLimitPremium,
            updatedAt: new Date(),
          },
        });

      await recordTeamUsageAuditLog({
        ctx,
        organizationId: input.organizationId,
        action: "default_policy_updated",
        metadata: {
          previous: {
            maxModeEnabled: previousPolicy.defaultMaxModeEnabled,
            maxModeLimitBasic: previousPolicy.defaultMaxModeLimitBasic,
            maxModeLimitPremium: previousPolicy.defaultMaxModeLimitPremium,
          },
          next: {
            maxModeEnabled: input.maxModeEnabled,
            maxModeLimitBasic: input.maxModeLimitBasic,
            maxModeLimitPremium: input.maxModeLimitPremium,
          },
        },
      });

      return { success: true };
    }),

  updateTeamMaxModeEnabled: billingEnabledProcedure
    .use(stripeWrite("updateTeamMaxModeEnabled"))
    .input(z.object({ organizationId: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const subscription = await getOwnedTeamBillingRecord(ctx, input.organizationId);
      const updates: Partial<BillingRecord> = {
        maxModeEnabled: input.enabled,
        updatedAt: new Date(),
      };

      await ctx.db.update(billing).set(updates).where(eq(billing.id, subscription.id));
      await recordTeamUsageAuditLog({
        ctx,
        organizationId: input.organizationId,
        action: input.enabled ? "max_mode_enabled" : "max_mode_disabled",
        metadata: {
          previous: { maxModeEnabled: Boolean(subscription.maxModeEnabled) },
          next: { maxModeEnabled: input.enabled },
        },
      });
      return { success: true };
    }),

  createTeamMaxModeCreditCheckout: billingEnabledProcedure
    .use(stripeWrite("createTeamMaxModeCreditCheckout"))
    .input(
      z.object({
        organizationId: z.string().min(1),
        credits: z.number().int().min(MAX_MODE_CREDIT_MIN).max(MAX_MODE_CREDIT_MAX),
        saveCard: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const subscription = await getOwnedTeamBillingRecord(ctx, input.organizationId);
      const url = await createMaxModeCreditCheckout({
        owner: { userId: null, organizationId: input.organizationId },
        credits: input.credits,
        stripeCustomerId: subscription.stripeCustomerId,
        purchasedByUserId: ctx.userId,
        saveCard: input.saveCard,
        returnPath: `/settings/team?organizationId=${encodeURIComponent(input.organizationId)}`,
      });
      return { url };
    }),

  updateTeamMaxModeAutoTopUp: billingEnabledProcedure
    .use(stripeWrite("updateTeamMaxModeAutoTopUp"))
    .input(
      z.object({
        organizationId: z.string().min(1),
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
      await getOwnedTeamBillingRecord(ctx, input.organizationId);
      const { organizationId, ...settings } = input;
      const result = await updateMaxModeAutoTopUp({ userId: null, organizationId }, settings);
      if (!result.success) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      return { success: true };
    }),

  updateTeamMemberMaxModePolicy: billingEnabledProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        userId: z.string().min(1),
        maxModeEnabled: z.boolean(),
        maxModeLimitBasic: maxModeLimitSchema,
        maxModeLimitPremium: maxModeLimitSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await verifyOrgOwnerOrAdmin(ctx, input.organizationId);
      const [targetMember] = await ctx.db
        .select({ id: member.id })
        .from(member)
        .where(
          and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)),
        )
        .limit(1);

      if (!targetMember) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member does not belong to this organization.",
        });
      }

      const [previousMemberPolicyRows, defaultPolicy] = await Promise.all([
        ctx.db
          .select({
            maxModeEnabled: teamMemberUsagePolicy.maxModeEnabled,
            maxModeLimitBasic: teamMemberUsagePolicy.maxModeLimitBasic,
            maxModeLimitPremium: teamMemberUsagePolicy.maxModeLimitPremium,
          })
          .from(teamMemberUsagePolicy)
          .where(
            and(
              eq(teamMemberUsagePolicy.organizationId, input.organizationId),
              eq(teamMemberUsagePolicy.userId, input.userId),
            ),
          )
          .limit(1),
        ensureTeamUsagePolicy(ctx, input.organizationId),
      ]);
      const [previousMemberPolicy] = previousMemberPolicyRows;

      await ctx.db
        .insert(teamMemberUsagePolicy)
        .values({
          organizationId: input.organizationId,
          userId: input.userId,
          maxModeEnabled: input.maxModeEnabled,
          maxModeLimitBasic: input.maxModeLimitBasic,
          maxModeLimitPremium: input.maxModeLimitPremium,
        })
        .onConflictDoUpdate({
          target: [teamMemberUsagePolicy.organizationId, teamMemberUsagePolicy.userId],
          set: {
            maxModeEnabled: input.maxModeEnabled,
            maxModeLimitBasic: input.maxModeLimitBasic,
            maxModeLimitPremium: input.maxModeLimitPremium,
            updatedAt: new Date(),
          },
        });
      await recordTeamUsageAuditLog({
        ctx,
        organizationId: input.organizationId,
        action: "member_policy_updated",
        targetUserId: input.userId,
        metadata: {
          previous: {
            maxModeEnabled:
              previousMemberPolicy?.maxModeEnabled ?? defaultPolicy.defaultMaxModeEnabled,
            maxModeLimitBasic:
              previousMemberPolicy?.maxModeLimitBasic ?? defaultPolicy.defaultMaxModeLimitBasic,
            maxModeLimitPremium:
              previousMemberPolicy?.maxModeLimitPremium ?? defaultPolicy.defaultMaxModeLimitPremium,
          },
          next: {
            maxModeEnabled: input.maxModeEnabled,
            maxModeLimitBasic: input.maxModeLimitBasic,
            maxModeLimitPremium: input.maxModeLimitPremium,
          },
        },
      });

      return { success: true };
    }),

  createTeamCheckoutSession: billingEnabledProcedure
    .use(stripeWrite("createTeamCheckoutSession"))
    .input(
      z.object({
        planId: teamPlanIdSchema,
        organizationId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await verifyOrgOwner(ctx, input.organizationId);

      const plan = findPlanById(input.planId);
      if (!plan) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown plan." });
      }

      await syncTeamSubscription(ctx, ctx.userId, input.organizationId);
      const billingRecord = await ensureTeamBillingRecord(ctx, ctx.userId, input.organizationId);

      const [price, reusableSession] = await Promise.all([
        getPriceForPlan(plan),
        reuseOpenTeamCheckoutSession({
          checkoutSessionId: billingRecord.checkoutSessionId,
          userId: ctx.userId,
          organizationId: input.organizationId,
          planId: plan.id,
        }),
      ]);

      if (reusableSession) {
        return {
          sessionId: reusableSession.id,
          clientSecret: reusableSession.client_secret,
        };
      }

      // Check for existing active subscription
      const existingSubs = await stripe.subscriptions.list({
        customer: billingRecord.stripeCustomerId,
        status: "all",
        limit: 10,
      });

      const activeSub = existingSubs.data.find(
        (sub) =>
          !isMaxModeOnlySubscription(sub) &&
          (ACTIVE_SUB_STATUSES.has(sub.status) || sub.cancel_at_period_end === true),
      );

      if (activeSub) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This team already has an active subscription. Use Change plan or cancel first.",
        });
      }

      const memberCount = await getOrgMemberCount(input.organizationId);

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
              quantity: memberCount,
            },
          ],
          metadata: {
            userId: ctx.userId,
            planId: plan.id,
            organizationId: input.organizationId,
          },
          subscription_data: {
            metadata: {
              userId: ctx.userId,
              planId: plan.id,
              organizationId: input.organizationId,
            },
          },
          payment_method_options: checkoutCardPaymentMethodOptions,
          allow_promotion_codes: true,
          return_url: `${new URL(env.NEXT_PUBLIC_BETTER_AUTH_URL).origin}/settings/team/checkout/{CHECKOUT_SESSION_ID}?organizationId=${input.organizationId}`,
        },
        customCheckoutRequestOptions,
      );

      await saveTeamBillingRecord(ctx.db, ctx.userId, input.organizationId, {
        stripeCustomerId: billingRecord.stripeCustomerId,
        planId: plan.id,
        priceId: price.id,
        status: "pending",
        mode: "subscription",
        checkoutSessionId: session.id,
      });

      if (!session.client_secret) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stripe did not return a checkout client secret.",
        });
      }

      return { sessionId: session.id, clientSecret: session.client_secret };
    }),
  getTeamCheckoutSession: billingEnabledProcedure
    .use(stripeRead("getTeamCheckoutSession"))
    .input(
      z.object({
        organizationId: z.string().min(1),
        sessionId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      await verifyOrgOwner(ctx, input.organizationId);

      const session = await stripe.checkout.sessions.retrieve(
        input.sessionId,
        { expand: [...checkoutSessionExpand] },
        customCheckoutRequestOptions,
      );

      if (session.client_reference_id && session.client_reference_id !== ctx.userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Session does not belong to the current user.",
        });
      }

      if (session.metadata?.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Session does not belong to the selected organization.",
        });
      }

      return summarizeCheckoutSession(session);
    }),

  createTeamPortalSession: billingEnabledProcedure
    .use(stripeWrite("createTeamPortalSession"))
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await verifyOrgOwner(ctx, input.organizationId);
      const subscription = await syncTeamSubscription(ctx, ctx.userId, input.organizationId);

      const portal = await createBillingPortalSession(
        subscription.stripeCustomerId,
        "/settings/team",
      );

      return { url: portal.url };
    }),

  estimateTeamPlanChange: billingEnabledProcedure
    .use(stripeRead("estimateTeamPlanChange"))
    .input(
      z.object({
        organizationId: z.string().min(1),
        planId: teamPlanIdSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      await verifyOrgOwner(ctx, input.organizationId);

      const plan = findPlanById(input.planId);
      if (!plan) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target plan must be a team subscription plan.",
        });
      }

      const [price, subscriptionState, memberCount] = await Promise.all([
        getPriceForPlan(plan),
        syncTeamSubscription(ctx, ctx.userId, input.organizationId),
        getOrgMemberCount(input.organizationId),
      ]);
      if (!subscriptionState.stripeSubscriptionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active team subscription found.",
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

      // Same items and proration as changeTeamPlan, so the preview is what gets charged.
      const preview = await stripe.invoices.createPreview({
        customer:
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id,
        subscription: subscription.id,
        subscription_details: {
          items: [{ id: item.id, price: price.id, quantity: memberCount }],
          proration_behavior: "always_invoice",
        },
      });

      return {
        amountDue: preview.amount_due ?? 0,
        currency: preview.currency ?? price.currency ?? null,
        memberCount,
      };
    }),

  changeTeamPlan: billingEnabledProcedure
    .use(stripeWrite("changeTeamPlan"))
    .input(
      z.object({
        organizationId: z.string().min(1),
        planId: teamPlanIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await verifyOrgOwner(ctx, input.organizationId);

      const plan = findPlanById(input.planId);
      if (!plan) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target plan must be a team subscription plan.",
        });
      }

      const [price, subscriptionState] = await Promise.all([
        getPriceForPlan(plan),
        syncTeamSubscription(ctx, ctx.userId, input.organizationId),
      ]);
      if (!subscriptionState.stripeSubscriptionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active team subscription found.",
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

      const updated = await withTeamBillingLock(ctx.db, input.organizationId, async (tx) => {
        const memberCount = await getOrgMemberCount(input.organizationId, tx);
        return stripe.subscriptions.update(subscription.id, {
          items: [{ id: item.id, price: price.id, quantity: memberCount }],
          metadata: {
            userId: ctx.userId,
            planId: plan.id,
            organizationId: input.organizationId,
          },
          proration_behavior: "always_invoice",
          payment_behavior: "error_if_incomplete",
        });
      });

      const updates: Partial<BillingRecord> = {
        planId: plan.id,
        priceId: price.id,
        mode: "subscription",
        status: updated.cancel_at_period_end ? "canceled" : updated.status,
        currentPeriodEnd: getSubscriptionPeriodEndDate(updated),
        stripeSubscriptionId: updated.id,
      };

      const saved = await saveTeamSubscriptionSnapshot(ctx, subscriptionState, {
        ...updates,
        stripeCustomerId: subscriptionState.stripeCustomerId,
      });

      if (subscriptionState.planId && subscriptionState.planId !== plan.id) {
        await recordTeamUsageAuditLog({
          ctx,
          organizationId: input.organizationId,
          action: "plan_changed",
          metadata: {
            previous: { planId: subscriptionState.planId },
            next: { planId: plan.id },
          },
        });
      }

      return {
        planId: saved.planId ?? null,
        status: saved.status ?? null,
        currentPeriodEnd: saved.currentPeriodEnd ?? null,
      };
    }),

  cancelTeamSubscription: billingEnabledProcedure
    .use(stripeWrite("cancelTeamSubscription"))
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await verifyOrgOwnerOrAdmin(ctx, input.organizationId);

      const subscriptionState = await syncTeamSubscription(ctx, ctx.userId, input.organizationId);
      if (!subscriptionState.stripeSubscriptionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active team subscription to cancel.",
        });
      }

      const canceled = await stripe.subscriptions.update(subscriptionState.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      const updates: Partial<BillingRecord> = {
        status: canceled.cancel_at_period_end ? "canceled" : canceled.status,
        cancelAt: canceled.cancel_at ?? null,
        currentPeriodEnd:
          getSubscriptionPeriodEndDate(canceled) ?? subscriptionState.currentPeriodEnd,
      };

      const saved = await saveTeamSubscriptionSnapshot(ctx, subscriptionState, {
        stripeSubscriptionId: subscriptionState.stripeSubscriptionId,
        ...updates,
        stripeCustomerId: subscriptionState.stripeCustomerId,
      });

      await recordTeamUsageAuditLog({
        ctx,
        organizationId: input.organizationId,
        action: "subscription_canceled",
        metadata: { planId: saved.planId, cancelAt: saved.cancelAt },
      });

      return {
        planId: saved.planId ?? null,
        status: saved.status ?? null,
        cancelAt: saved.cancelAt ?? null,
        currentPeriodEnd: saved.currentPeriodEnd ?? null,
      };
    }),

  resumeTeamSubscription: billingEnabledProcedure
    .use(stripeWrite("resumeTeamSubscription"))
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await verifyOrgOwnerOrAdmin(ctx, input.organizationId);

      const subscriptionState = await syncTeamSubscription(ctx, ctx.userId, input.organizationId);
      if (!subscriptionState.stripeSubscriptionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No team subscription to resume.",
        });
      }

      const resumed = await stripe.subscriptions.update(subscriptionState.stripeSubscriptionId, {
        cancel_at_period_end: false,
      });

      const price = getLicensedPrice(resumed) ?? resumed.items.data.at(0)?.price ?? null;
      const plan =
        billingPlans.find((p) => p.lookupKey === price?.lookup_key) ??
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

      const saved = await saveTeamSubscriptionSnapshot(ctx, subscriptionState, {
        ...updates,
        stripeCustomerId: subscriptionState.stripeCustomerId,
      });

      await recordTeamUsageAuditLog({
        ctx,
        organizationId: input.organizationId,
        action: "subscription_resumed",
        metadata: { planId: saved.planId },
      });

      return {
        planId: saved.planId ?? null,
        status: saved.status ?? null,
        currentPeriodEnd: saved.currentPeriodEnd ?? null,
      };
    }),

  syncSeatCount: billingEnabledProcedure
    .use(stripeWrite("syncSeatCount"))
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await verifyOrgOwner(ctx, input.organizationId);
      await updateTeamSeatCount(input.organizationId);
      const memberCount = await getOrgMemberCount(input.organizationId);
      await recordTeamUsageAuditLog({
        ctx,
        organizationId: input.organizationId,
        action: "seats_synced",
        metadata: { memberCount },
      });
      return { success: true };
    }),
});
