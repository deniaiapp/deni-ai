import { and, asc, eq, isNotNull, isNull, like, lte, or, sql } from "drizzle-orm";

import { db } from "@/db/drizzle";
import {
  billing,
  member,
  productUsage,
  teamMemberUsagePolicy,
  teamUsagePolicy,
  usageQuota,
  usageReservation,
} from "@/db/schema";
import { getPlanTier, isMaxTeamPlan } from "@/lib/billing";
import { isSignupFlagged } from "@/lib/signup-risk";
import { canonicalTeamBillingRow } from "@/lib/team-billing-record";

import { isMaxModeEligible, deliverMaxModeUsageReport } from "./max-mode";
import { recordProductUsage, usageMonthStart } from "./product-usage-ledger";
import {
  FLAGGED_FREE_POOL_USD,
  USAGE_POOL_USD,
  USAGE_UNITS_PER_USD_MICRO,
  usdToUsageUnits,
  VERIFIED_FREE_POOL_USD,
} from "./usage-pool";
import { enqueueMaxModeMeterEvent } from "./max-mode-meter-events";
import { isBillingDisabled } from "./billing-config";
import { requestUsageAndMeterCheck } from "./usage-and-meter-schedule";

const ACTIVE_BILLING_STATUSES = new Set(["active", "trialing", "past_due", "paid"]);

/**
 * Quota row categories. Usage is no longer split by model class: every request
 * (Deni AI chat and Flixa) is recorded on {@link SHARED_USAGE_CATEGORY}. "premium"
 * remains for rows, reservations, and Max Mode meters written before the change.
 */
export type UsageCategory = "basic" | "premium";

export const SHARED_USAGE_CATEGORY: UsageCategory = "basic";
export type SubscriptionTier = "free" | "plus" | "pro" | "max";
/**
 * Quota rows count usage units (usage-pool.ts): weighted tokens for chat and Flixa,
 * converted provider cost for Deni Run. Rows stored as "tokens" or "requests" before
 * 2026-11 read as a different unit and reset.
 */
export type UsageUnit = "units";
type UsageRecord = typeof usageQuota.$inferSelect;
type UsageDatabase = Pick<typeof db, "select" | "insert" | "update">;

/** An unsettled reservation silent this long is recovered by the usage and meter job. */
export const USAGE_RESERVATION_STALE_MS = 15 * 60_000;

function withUsageLock<T>(
  userId: string,
  run: (database: UsageDatabase) => Promise<T>,
): Promise<T> {
  return db.transaction(
    async (transaction) => {
      // Also protects the empty-quota case and serializes consume/refund across instances.
      await transaction.execute(sql`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`);
      return run(transaction);
    },
    { isolationLevel: "read committed" },
  );
}

/** Usage units charged per successful `search` tool call. */
export const SEARCH_TOOL_USAGE_COST = 10_000;

/** A guest's allowance in usage units. It never resets (guest rows have no period end). */
const GUEST_USAGE_LIMITS: Record<UsageCategory, number> = {
  basic: 1_000_000,
  premium: 0,
};

/** The plan's monthly pool in usage units, shared by chat, Flixa, and Deni Run (usage-pool.ts). */
export function getUsagePoolUnits(tier: SubscriptionTier) {
  return usdToUsageUnits(USAGE_POOL_USD[tier]);
}

function poolUnitsFor(tierInfo: TierInfo) {
  if (tierInfo.tier === "free" && tierInfo.hasVerifiedPaymentMethod)
    return usdToUsageUnits(VERIFIED_FREE_POOL_USD);
  // Free accounts whose sign-up looked like part of a batch (see signup-risk.ts) get a
  // smaller pool until a payment method is verified. Enough to try; not enough to farm.
  if (tierInfo.tier === "free" && tierInfo.signupFlagged)
    return usdToUsageUnits(FLAGGED_FREE_POOL_USD);
  return getUsagePoolUnits(tierInfo.tier);
}

/** A quota row's usage in the current window (0 once its period or unit has moved on). */
function liveUsed(record: UsageRecord | undefined, now: Date, unit: UsageUnit) {
  if (!record || record.unit !== unit) return 0;
  if (!record.periodEnd || record.periodEnd <= now) return 0;
  return Number(record.used);
}

/**
 * This month's per-product ledger: Deni AI chat and Flixa in usage units (their split of
 * the quota rows) and Deni Run's spend converted from micro-dollars.
 */
async function monthLedger(userId: string, now: Date, database: UsageDatabase) {
  const rows = await database
    .select({ product: productUsage.product, unit: productUsage.unit, used: productUsage.used })
    .from(productUsage)
    .where(
      and(eq(productUsage.userId, userId), eq(productUsage.periodStart, usageMonthStart(now))),
    );
  const ledger = { chat: 0, flixa: 0, run: 0 };
  for (const row of rows) {
    if (row.product === "run" && row.unit === "usd_micros")
      ledger.run += Number(row.used) * USAGE_UNITS_PER_USD_MICRO;
    else if ((row.product === "chat" || row.product === "flixa") && row.unit === "units")
      ledger[row.product] += Number(row.used);
  }
  ledger.run = Math.round(ledger.run);
  return ledger;
}

/** Deni Run's spend this month (its ledger is in micro-dollars), in usage units. */
async function runUsageUnits(userId: string, now: Date, database: UsageDatabase) {
  const [row] = await database
    .select({ total: sql<number | null>`coalesce(sum(${productUsage.used}), 0)` })
    .from(productUsage)
    .where(
      and(
        eq(productUsage.userId, userId),
        eq(productUsage.product, "run"),
        eq(productUsage.unit, "usd_micros"),
        eq(productUsage.periodStart, usageMonthStart(now)),
      ),
    );
  return Math.round(Number(row?.total ?? 0) * USAGE_UNITS_PER_USD_MICRO);
}

export class UsageLimitError extends Error {
  public maxModeAvailable: boolean;

  constructor(message: string, maxModeAvailable = false) {
    super(message);
    this.name = "UsageLimitError";
    this.maxModeAvailable = maxModeAvailable;
  }
}

type TierInfo = {
  deletionPending: boolean;
  billingId: string | null;
  stripeCustomerId: string | null;
  tier: SubscriptionTier;
  planId: string | null;
  status: string | null;
  periodEnd: Date | null;
  maxModeEnabled: boolean;
  maxModeEligible: boolean;
  maxModeMemberEnabled: boolean;
  maxModeLimitBasic: number | null;
  maxModeLimitPremium: number | null;
  hasVerifiedPaymentMethod: boolean;
  /** Free account flagged at sign-up as part of a batch; only looked up for unverified Free accounts. */
  signupFlagged?: boolean;
};

function getDefaultPeriodEnd(now: Date) {
  const startOfNextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return startOfNextMonth;
}

export async function isFreeAdViewer(userId: string): Promise<boolean> {
  return (await getTierInfo(userId, new Date())).tier === "free";
}

export async function canCompareModels(userId: string): Promise<boolean> {
  const { tier } = await getTierInfo(userId, new Date());
  return tier === "pro" || tier === "max";
}

/** The plan tier a (non-guest) user's limits follow, including team and lifetime plans. */
export async function getSubscriptionTier(
  userId: string,
  now = new Date(),
): Promise<SubscriptionTier> {
  return (await loadTierInfo(userId, now, db)).tier;
}

async function getTierInfo(
  userId: string,
  now: Date,
  database: UsageDatabase = db,
): Promise<TierInfo> {
  const info = await loadTierInfo(userId, now, database);
  if (info.tier === "free" && !info.hasVerifiedPaymentMethod) {
    info.signupFlagged = await isSignupFlagged(userId, database);
  }
  return info;
}

async function loadTierInfo(userId: string, now: Date, database: UsageDatabase): Promise<TierInfo> {
  // 1. Check personal billing (where organizationId is NULL)
  const [record] = await database
    .select({
      id: billing.id,
      deletionPending: billing.deletionPending,
      stripeCustomerId: billing.stripeCustomerId,
      organizationId: billing.organizationId,
      planId: billing.planId,
      status: billing.status,
      currentPeriodEnd: billing.currentPeriodEnd,
      maxModeEnabled: billing.maxModeEnabled,
      paymentMethodFingerprint: billing.paymentMethodFingerprint,
      cardRemovedAt: billing.cardRemovedAt,
    })
    .from(billing)
    .where(and(eq(billing.userId, userId), isNull(billing.organizationId)))
    .limit(1);

  // A removed card keeps its fingerprint for reuse limits but no longer verifies.
  const hasVerifiedPaymentMethod =
    Boolean(record?.paymentMethodFingerprint) && !record?.cardRemovedAt;

  // 2. Check if user belongs to any org with an active team plan
  const teamRecords = await database
    .select({
      id: billing.id,
      deletionPending: billing.deletionPending,
      stripeCustomerId: billing.stripeCustomerId,
      organizationId: billing.organizationId,
      planId: billing.planId,
      status: billing.status,
      currentPeriodEnd: billing.currentPeriodEnd,
      maxModeEnabled: billing.maxModeEnabled,
    })
    .from(billing)
    .innerJoin(member, eq(billing.organizationId, member.organizationId))
    .where(
      and(
        eq(member.userId, userId),
        isNotNull(billing.organizationId),
        canonicalTeamBillingRow(),
        or(like(billing.planId, "pro_team%"), like(billing.planId, "max_team%")),
      ),
    );

  const teamRecord = teamRecords.find((candidate) => {
    const teamStatus = candidate.status;
    const teamHasActive =
      Boolean(candidate.planId) &&
      Boolean(teamStatus) &&
      ACTIVE_BILLING_STATUSES.has(teamStatus ?? "");
    const teamGracePeriod =
      teamStatus === "canceled" && candidate.currentPeriodEnd && candidate.currentPeriodEnd > now;

    return teamHasActive || teamGracePeriod;
  });

  // 3. If user has an active team plan, check it first
  if (teamRecord) {
    const teamPlanId = teamRecord.planId;
    const teamStatus = teamRecord.status;
    const maxModeEligible = isMaxModeEligible(teamPlanId) && teamStatus === "active";
    const [memberPolicy, defaultPolicy] = teamRecord.organizationId
      ? await Promise.all([
          database
            .select({
              maxModeEnabled: teamMemberUsagePolicy.maxModeEnabled,
              maxModeLimitBasic: teamMemberUsagePolicy.maxModeLimitBasic,
              maxModeLimitPremium: teamMemberUsagePolicy.maxModeLimitPremium,
            })
            .from(teamMemberUsagePolicy)
            .where(
              and(
                eq(teamMemberUsagePolicy.organizationId, teamRecord.organizationId),
                eq(teamMemberUsagePolicy.userId, userId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0]),
          database
            .select({
              defaultMaxModeEnabled: teamUsagePolicy.defaultMaxModeEnabled,
              defaultMaxModeLimitBasic: teamUsagePolicy.defaultMaxModeLimitBasic,
              defaultMaxModeLimitPremium: teamUsagePolicy.defaultMaxModeLimitPremium,
            })
            .from(teamUsagePolicy)
            .where(eq(teamUsagePolicy.organizationId, teamRecord.organizationId))
            .limit(1)
            .then((rows) => rows[0]),
        ])
      : [];

    const memberMaxModeEnabled =
      memberPolicy?.maxModeEnabled ?? defaultPolicy?.defaultMaxModeEnabled ?? true;

    return {
      billingId: teamRecord.id,
      deletionPending: Boolean(record?.deletionPending || teamRecord.deletionPending),
      stripeCustomerId: teamRecord.stripeCustomerId,
      tier: isMaxTeamPlan(teamPlanId) ? "max" : "pro",
      planId: teamPlanId,
      status: teamStatus ?? null,
      periodEnd: teamRecord.currentPeriodEnd ?? null,
      maxModeEnabled: maxModeEligible && teamRecord.maxModeEnabled && memberMaxModeEnabled,
      maxModeEligible: maxModeEligible && teamRecord.maxModeEnabled && memberMaxModeEnabled,
      maxModeMemberEnabled: memberMaxModeEnabled,
      maxModeLimitBasic:
        memberPolicy?.maxModeLimitBasic ?? defaultPolicy?.defaultMaxModeLimitBasic ?? null,
      maxModeLimitPremium:
        memberPolicy?.maxModeLimitPremium ?? defaultPolicy?.defaultMaxModeLimitPremium ?? null,
      hasVerifiedPaymentMethod,
    };
  }

  // 4. Fall back to personal billing
  if (!record) {
    return {
      billingId: null,
      deletionPending: false,
      stripeCustomerId: null,
      tier: "free",
      planId: null,
      status: null,
      periodEnd: getDefaultPeriodEnd(now),
      maxModeEnabled: false,
      maxModeEligible: false,
      maxModeMemberEnabled: true,
      maxModeLimitBasic: null,
      maxModeLimitPremium: null,
      hasVerifiedPaymentMethod,
    };
  }

  const planId = record.planId;
  const status = record.status;
  const hasActiveStatus =
    Boolean(planId) && Boolean(status) && ACTIVE_BILLING_STATUSES.has(status ?? "");
  const inGracePeriod =
    status === "canceled" && record.currentPeriodEnd && record.currentPeriodEnd > now;

  if (!hasActiveStatus && !inGracePeriod) {
    return {
      billingId: record.id,
      deletionPending: record.deletionPending,
      stripeCustomerId: record.stripeCustomerId,
      tier: "free",
      planId,
      status,
      periodEnd: getDefaultPeriodEnd(now),
      maxModeEnabled: false,
      maxModeEligible: false,
      maxModeMemberEnabled: true,
      maxModeLimitBasic: null,
      maxModeLimitPremium: null,
      hasVerifiedPaymentMethod,
    };
  }

  const planTier = getPlanTier(planId);
  const maxModeEligible = isMaxModeEligible(planId) && status === "active";

  return {
    billingId: record.id,
    deletionPending: record.deletionPending,
    stripeCustomerId: record.stripeCustomerId,
    tier:
      planTier === "max"
        ? "max"
        : planTier === "pro"
          ? "pro"
          : planTier === "team"
            ? "pro"
            : planTier === "plus"
              ? "plus"
              : "free",
    planId,
    status: status ?? null,
    periodEnd: record.currentPeriodEnd ?? null,
    maxModeEnabled: maxModeEligible && record.maxModeEnabled,
    maxModeEligible,
    maxModeMemberEnabled: true,
    maxModeLimitBasic: null,
    maxModeLimitPremium: null,
    hasVerifiedPaymentMethod,
  };
}

function resolvePeriodEnd(now: Date) {
  return getDefaultPeriodEnd(now);
}

function isUsageUnit(value: string | null | undefined): value is UsageUnit {
  return value === "units";
}

/**
 * Chat, Flixa, and Deni Run share one pool per plan. A category's limit is what
 * the pool has left after the other category and Deni Run, so a request is refused
 * once the pool as a whole is spent. Guests keep their own allowance.
 */
async function calculateUsageState({
  userId,
  category,
  now,
  records: providedRecords,
  runUnits: providedRunUnits,
  isAnonymous = false,
  database = db,
  tierInfo: providedTierInfo,
}: {
  userId: string;
  category: UsageCategory;
  now: Date;
  /** All of the user's quota rows, when the caller already has them. */
  records?: UsageRecord[];
  runUnits?: number;
  isAnonymous?: boolean;
  database?: UsageDatabase;
  tierInfo?: TierInfo;
}) {
  const tierInfo = providedTierInfo ?? (await getTierInfo(userId, now, database));
  const records =
    providedRecords ??
    (await database.select().from(usageQuota).where(eq(usageQuota.userId, userId)));
  const current = records.find((row) => row.category === category);

  const unit: UsageUnit = "units";
  let limit: number | null;
  if (isAnonymous) {
    limit = GUEST_USAGE_LIMITS[category];
  } else {
    const runUnits = providedRunUnits ?? (await runUsageUnits(userId, now, database));
    const others = records
      .filter((row) => row.category !== category)
      .reduce((sum, row) => sum + liveUsed(row, now, unit), runUnits);
    limit = Math.max(poolUnitsFor(tierInfo) - others, 0);
  }

  const targetPeriodEnd = isAnonymous ? null : resolvePeriodEnd(now);
  const storedUnit = isUsageUnit(current?.unit) ? current.unit : null;
  const hasUnitMismatch = Boolean(current) && storedUnit !== unit;

  const shouldReset = !current
    ? true
    : hasUnitMismatch
      ? true
      : isAnonymous
        ? false
        : !current.periodEnd || current.periodEnd <= now;

  const used = limit === null ? (current?.used ?? 0) : shouldReset ? 0 : (current?.used ?? 0);
  const periodStart = shouldReset ? now : (current?.periodStart ?? now);

  return {
    tierInfo,
    unit,
    // Callers and their tests treat a limit as nullable (no limit).
    limit: limit as number | null,
    current,
    targetPeriodEnd,
    shouldReset,
    used,
    periodStart,
  };
}

function asTimestamptz(value: Date) {
  return sql`${value.toISOString()}::timestamptz`;
}

function buildResetWindowCondition({
  now,
  targetPeriodEnd,
  unit,
}: {
  now: Date;
  targetPeriodEnd: Date | null;
  unit: UsageUnit;
}) {
  const unitMismatchCondition = sql`${usageQuota.unit} IS DISTINCT FROM ${unit}`;

  if (!targetPeriodEnd) {
    return unitMismatchCondition;
  }

  return sql`(${usageQuota.periodEnd} IS NULL OR ${usageQuota.periodEnd} <= ${asTimestamptz(now)}) OR ${unitMismatchCondition}`;
}

async function upsertUsageRecord({
  userId,
  category,
  tier,
  limit,
  unit,
  amount,
  periodStart,
  targetPeriodEnd,
  resetWindowCondition,
  allowOverflow,
  database,
}: {
  userId: string;
  category: UsageCategory;
  tier: SubscriptionTier;
  limit: number;
  unit: UsageUnit;
  amount: number;
  periodStart: Date;
  targetPeriodEnd: Date | null;
  resetWindowCondition: ReturnType<typeof buildResetWindowCondition>;
  allowOverflow: boolean;
  database: UsageDatabase;
}) {
  const usedExpression = resetWindowCondition
    ? sql`CASE
        WHEN ${resetWindowCondition} THEN ${amount}
        ELSE ${usageQuota.used} + ${amount}
      END`
    : sql`${usageQuota.used} + ${amount}`;

  const periodStartExpression = resetWindowCondition
    ? sql`CASE
        WHEN ${resetWindowCondition} THEN ${asTimestamptz(periodStart)}
        ELSE ${usageQuota.periodStart}
      END`
    : usageQuota.periodStart;

  const periodEndExpression = resetWindowCondition
    ? sql`CASE
        WHEN ${resetWindowCondition} THEN ${targetPeriodEnd ? asTimestamptz(targetPeriodEnd) : sql`null`}
        ELSE ${usageQuota.periodEnd}
      END`
    : usageQuota.periodEnd;

  const remainingCondition = sql`${usageQuota.used} <= ${limit - amount}`;
  const setWhere = allowOverflow
    ? undefined
    : resetWindowCondition
      ? sql`${resetWindowCondition} OR ${remainingCondition}`
      : remainingCondition;

  const [saved] = await database
    .insert(usageQuota)
    .values({
      userId,
      category,
      planTier: tier,
      limitAmount: limit,
      unit,
      used: amount,
      periodStart,
      periodEnd: targetPeriodEnd,
    })
    .onConflictDoUpdate({
      target: [usageQuota.userId, usageQuota.category],
      set: {
        planTier: tier,
        limitAmount: limit,
        unit,
        used: usedExpression,
        periodStart: periodStartExpression,
        periodEnd: periodEndExpression,
        updatedAt: new Date(),
      },
      ...(setWhere ? { setWhere } : {}),
    })
    .returning({ used: usageQuota.used });

  return saved ?? null;
}

export type UsagePeriod = { unit: UsageUnit; start: Date; end: Date | null };

async function reservationTotals(
  database: UsageDatabase,
  userId: string,
  category: UsageCategory,
  period: UsagePeriod,
) {
  const [totals] = await database
    .select({
      baseUsed: sql<number | null>`max(${usageReservation.baseUsed})`,
      settledUsed: sql<number>`coalesce(sum(${usageReservation.settledAmount}), 0)`,
    })
    .from(usageReservation)
    .where(
      and(
        eq(usageReservation.userId, userId),
        eq(usageReservation.category, category),
        eq(usageReservation.unit, period.unit),
        eq(usageReservation.periodStart, period.start),
        sql`${usageReservation.periodEnd} IS NOT DISTINCT FROM ${period.end ? asTimestamptz(period.end) : sql`NULL`}`,
      ),
    );
  return {
    baseUsed: totals?.baseUsed == null ? null : Number(totals.baseUsed),
    settledUsed: Number(totals?.settledUsed ?? 0),
  };
}

/** Reserve quota only. Pending estimates are never written to Stripe's meter. */
export async function consumeUsage({
  userId,
  category,
  reservationId,
  amount = 1,
  now = new Date(),
  isAnonymous = false,
}: {
  userId: string;
  category: UsageCategory;
  reservationId: string;
  amount?: number;
  now?: Date;
  isAnonymous?: boolean;
}) {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error("Usage amount must be a positive safe integer.");
  return withUsageLock(userId, async (database) => {
    const [existing] = await database
      .select()
      .from(usageReservation)
      .where(eq(usageReservation.id, reservationId))
      .limit(1);
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.category !== category ||
        existing.reservedAmount !== amount
      )
        throw new Error("Usage reservation identity conflict.");
      return {
        reservationId,
        period: { unit: existing.unit, start: existing.periodStart, end: existing.periodEnd },
        unit: existing.unit,
        limit: existing.limitAmount,
        remaining: null,
        usedMaxMode: false,
        maxModeAmount: 0,
      };
    }
    const state = await calculateUsageState({ userId, category, now, isAnonymous, database });
    const { tierInfo, limit, unit } = state;
    if (tierInfo.deletionPending) throw new UsageLimitError("Account deletion is in progress.");
    const maxModeEnabled = !isAnonymous && tierInfo.maxModeEnabled;
    const period: UsagePeriod = {
      unit,
      start: state.periodStart,
      end: state.shouldReset ? state.targetPeriodEnd : (state.current?.periodEnd ?? null),
    };
    const maxModeLimit =
      category === "basic" ? tierInfo.maxModeLimitBasic : tierInfo.maxModeLimitPremium;
    const overage = limit === null ? 0 : Math.max(state.used + amount - limit, 0);
    if (overage > 0 && (!maxModeEnabled || (maxModeLimit !== null && overage > maxModeLimit))) {
      throw new UsageLimitError("Usage limit reached for your plan.", tierInfo.maxModeEligible);
    }
    const totals = await reservationTotals(database, userId, category, period);
    if (limit !== null) {
      const saved = await upsertUsageRecord({
        userId,
        category,
        tier: tierInfo.tier,
        limit,
        unit,
        amount,
        periodStart: state.periodStart,
        targetPeriodEnd: state.targetPeriodEnd,
        resetWindowCondition: buildResetWindowCondition({
          now,
          targetPeriodEnd: state.targetPeriodEnd,
          unit,
        }),
        allowOverflow: maxModeEnabled,
        database,
      });
      if (!saved)
        throw new UsageLimitError("Usage limit reached for your plan.", tierInfo.maxModeEligible);
    }
    await database.insert(usageReservation).values({
      id: reservationId,
      userId,
      category,
      unit,
      periodStart: period.start,
      periodEnd: period.end,
      reservedAmount: amount,
      baseUsed: totals.baseUsed ?? state.used,
      limitAmount: limit,
      maxModeEnabled,
      maxModeLimit,
      billingId: tierInfo.billingId,
      stripeCustomerId: tierInfo.stripeCustomerId,
      createdAt: now,
      updatedAt: now,
    });
    return {
      reservationId,
      tier: tierInfo.tier,
      period,
      unit,
      limit,
      remaining: limit === null ? null : Math.max(limit - state.used - amount, 0),
      usedMaxMode: overage > 0,
      maxModeAmount: 0,
    };
  });
}

/** Atomically settle actual usage, the original payer's ledger, and the durable meter event. */
export async function settleUsage({
  userId,
  reservationId,
  amount,
  now = new Date(),
  staleBefore,
}: {
  userId: string;
  reservationId: string;
  amount: number;
  now?: Date;
  staleBefore?: Date;
}) {
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new Error("Settled usage must be a nonnegative safe integer.");
  const result = await withUsageLock(userId, async (database) => {
    const [reservation] = await database
      .select()
      .from(usageReservation)
      .where(and(eq(usageReservation.id, reservationId), eq(usageReservation.userId, userId)))
      .limit(1);
    if (!reservation) throw new Error("Usage reservation not found.");
    if (reservation.settledAt)
      return { maxModeAmount: reservation.maxModeAmount, amount: reservation.settledAmount! };
    if (staleBefore) {
      if (reservation.updatedAt > staleBefore) return { maxModeAmount: 0, amount: null };
      amount = reservation.observedAmount;
    }
    const period = {
      unit: reservation.unit,
      start: reservation.periodStart,
      end: reservation.periodEnd,
    };
    const totals = await reservationTotals(database, userId, reservation.category, period);
    const committedUsed = reservation.baseUsed + totals.settledUsed;
    const limit = reservation.limitAmount;
    let maxModeAmount =
      isBillingDisabled || !reservation.maxModeEnabled || limit === null
        ? 0
        : Math.min(amount, Math.max(committedUsed + amount - limit, 0));
    if (reservation.maxModeLimit !== null && limit !== null) {
      maxModeAmount = Math.max(
        0,
        Math.min(maxModeAmount, reservation.maxModeLimit - Math.max(committedUsed - limit, 0)),
      );
    }
    if (limit !== null) {
      await database
        .update(usageQuota)
        .set({
          used: sql`GREATEST(${usageQuota.used} + ${amount - reservation.reservedAmount}, 0)`,
          updatedAt: now,
        })
        .where(
          and(
            eq(usageQuota.userId, userId),
            eq(usageQuota.category, reservation.category),
            eq(usageQuota.unit, period.unit),
            eq(usageQuota.periodStart, period.start),
            sql`${usageQuota.periodEnd} IS NOT DISTINCT FROM ${period.end ? asTimestamptz(period.end) : sql`NULL`}`,
          ),
        );
    }
    // The per-product ledger keeps Chat's share of the quota shared with Flixa.
    await recordProductUsage(
      {
        userId,
        product: "chat",
        metric: reservation.category,
        unit: period.unit,
        amount,
        at: reservation.createdAt,
      },
      database,
    );
    if (maxModeAmount > 0) {
      if (!reservation.stripeCustomerId || !reservation.billingId)
        throw new Error("Usage reservation has no billing identity.");
      const field = reservation.category === "basic" ? "maxModeUsageBasic" : "maxModeUsagePremium";
      const column =
        reservation.category === "basic" ? billing.maxModeUsageBasic : billing.maxModeUsagePremium;
      // Late settlement still bills the old period, without inflating a renewed period's dashboard.
      await database
        .update(billing)
        .set({ [field]: sql`${column} + ${maxModeAmount}` })
        .where(
          and(
            eq(billing.id, reservation.billingId),
            or(
              isNull(billing.maxModePeriodStart),
              sql`${billing.maxModePeriodStart} <= ${reservation.createdAt.toISOString()}::timestamp`,
            ),
          ),
        );
      await enqueueMaxModeMeterEvent(
        {
          id: reservationId,
          userId,
          category: reservation.category,
          amount: maxModeAmount,
          stripeCustomerId: reservation.stripeCustomerId,
          occurredAt: reservation.createdAt,
        },
        database,
      );
    }
    await database
      .update(usageReservation)
      .set({ settledAmount: amount, maxModeAmount, settledAt: now })
      .where(eq(usageReservation.id, reservationId));
    return { maxModeAmount, amount };
  }).catch((error: unknown) => {
    // The reservation stays unsettled: have the job recover it once it is stale.
    requestUsageAndMeterCheck(Date.now() + USAGE_RESERVATION_STALE_MS);
    throw error;
  });
  if (result.maxModeAmount > 0) {
    let delivered = false;
    try {
      delivered = ((await deliverMaxModeUsageReport(reservationId))?.delivered ?? 0) > 0;
    } catch (error) {
      console.error("Settled usage retained for meter delivery", { reservationId, error });
    }
    // A queued meter event is retried by the job; its retry time is read from the database.
    if (!delivered) requestUsageAndMeterCheck(Date.now() + 60_000);
  }
  return result;
}

/** Persist completed provider usage and refresh a running request's recovery lease. */
export async function recordObservedUsage({
  userId,
  reservationId,
  amount,
  now = new Date(),
}: {
  userId: string;
  reservationId: string;
  amount: number;
  now?: Date;
}) {
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new Error("Observed usage must be a nonnegative safe integer.");
  await withUsageLock(userId, async (database) => {
    await database
      .update(usageReservation)
      .set({
        observedAmount: sql`GREATEST(${usageReservation.observedAmount}, ${amount})`,
        updatedAt: now,
      })
      .where(
        and(
          eq(usageReservation.id, reservationId),
          eq(usageReservation.userId, userId),
          isNull(usageReservation.settledAt),
        ),
      );
  });
}

/** Recover interrupted requests from durable actual usage; never bill abandoned estimates. */
export async function recoverUsageReservations(now = new Date()) {
  const staleBefore = new Date(now.getTime() - USAGE_RESERVATION_STALE_MS);
  const stale = await db
    .select({ id: usageReservation.id, userId: usageReservation.userId })
    .from(usageReservation)
    .where(and(isNull(usageReservation.settledAt), lte(usageReservation.updatedAt, staleBefore)))
    .orderBy(asc(usageReservation.updatedAt))
    .limit(5);
  const result = { recovered: 0, recoveryFailed: 0 };
  for (const reservation of stale) {
    try {
      const settled = await settleUsage({
        userId: reservation.userId,
        reservationId: reservation.id,
        amount: 0,
        now,
        staleBefore,
      });
      if (settled.amount !== null) result.recovered++;
    } catch (error) {
      console.error("Usage reservation recovery failed", { reservationId: reservation.id, error });
      result.recoveryFailed++;
    }
  }
  return result;
}

export type UsageSnapshot = {
  category: UsageCategory;
  unit: UsageUnit;
  limit: number | null;
  used: number;
  remaining: number | null;
  periodStart: Date;
  periodEnd: Date | null;
};

/** The shared monthly pool, in usage units (usage-pool.ts); null for guests. */
export type UsagePoolSnapshot = {
  limit: number;
  /** Use by product: Deni AI chat, Flixa, and Deni Run. */
  used: { chat: number; flixa: number; run: number };
  periodEnd: Date;
};

export type UsageSummary = {
  tier: SubscriptionTier;
  pool: UsagePoolSnapshot | null;
  planId: string | null;
  status: string | null;
  periodEnd: Date | null;
  usage: UsageSnapshot[];
  maxModeEnabled: boolean;
  maxModeEligible: boolean;
  hasVerifiedPaymentMethod: boolean;
  /**
   * The Free allowance is reduced (see signup-risk.ts) and a verified payment method lifts it.
   * Tells the user the way out without saying what triggered it.
   */
  signupLimited: boolean;
};

export async function getUsageSummary({
  userId,
  now = new Date(),
  isAnonymous = false,
}: {
  userId: string;
  now?: Date;
  isAnonymous?: boolean;
}): Promise<UsageSummary> {
  const nowDate = now;
  const [tierInfo, records, ledger] = await Promise.all([
    getTierInfo(userId, nowDate),
    db.select().from(usageQuota).where(eq(usageQuota.userId, userId)),
    isAnonymous ? Promise.resolve({ chat: 0, flixa: 0, run: 0 }) : monthLedger(userId, nowDate, db),
  ]);

  const state = await calculateUsageState({
    userId,
    category: SHARED_USAGE_CATEGORY,
    now: nowDate,
    records,
    runUnits: ledger.run,
    isAnonymous,
    tierInfo,
  });

  // Chat and Flixa share the quota rows (rows from before the change may still hold
  // "premium" usage this month); the ledger says how much of it each product spent.
  const quotaUsed = records.reduce((sum, row) => sum + liveUsed(row, nowDate, "units"), 0);
  const ledgerUnits = ledger.chat + ledger.flixa;
  const flixaUsed = ledgerUnits > 0 ? Math.round((quotaUsed * ledger.flixa) / ledgerUnits) : 0;
  const pool = isAnonymous
    ? null
    : {
        limit: poolUnitsFor(tierInfo),
        used: { chat: quotaUsed - flixaUsed, flixa: flixaUsed, run: ledger.run },
        periodEnd: resolvePeriodEnd(nowDate),
      };
  const poolUsed = pool ? pool.used.chat + pool.used.flixa + pool.used.run : 0;

  // One entry for the one pool (guests: their own allowance).
  const usage: UsageSnapshot[] = [
    pool
      ? {
          category: SHARED_USAGE_CATEGORY,
          unit: "units",
          limit: pool.limit,
          used: poolUsed,
          remaining: Math.max(pool.limit - poolUsed, 0),
          periodStart: state.periodStart,
          periodEnd: pool.periodEnd,
        }
      : {
          category: SHARED_USAGE_CATEGORY,
          unit: state.unit,
          limit: state.limit,
          used: state.limit === null ? 0 : state.used,
          remaining: state.limit === null ? null : Math.max(state.limit - state.used, 0),
          periodStart: state.periodStart,
          periodEnd: state.targetPeriodEnd,
        },
  ];

  return {
    tier: tierInfo.tier,
    pool,
    planId: tierInfo.planId,
    status: tierInfo.status,
    periodEnd: tierInfo.periodEnd,
    usage,
    maxModeEnabled: tierInfo.maxModeEnabled,
    maxModeEligible: tierInfo.maxModeEligible,
    hasVerifiedPaymentMethod: tierInfo.hasVerifiedPaymentMethod,
    signupLimited: Boolean(tierInfo.signupFlagged) && !tierInfo.hasVerifiedPaymentMethod,
  };
}
