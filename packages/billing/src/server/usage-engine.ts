import { and, asc, eq, isNotNull, isNull, like, lte, sql } from "drizzle-orm";
import {
  billing,
  member,
  productUsage,
  teamMemberUsagePolicy,
  teamUsagePolicy,
  usageQuota,
  usageReservation,
  user,
} from "@deniai/db";

import { isEducationalEmail } from "../education";
import {
  ACTIVE_BILLING_STATUSES,
  getPlanTier as defaultGetPlanTier,
  isMaxModeEligible as defaultIsMaxModeEligible,
  MAX_MODE_USABLE_STATUSES,
  type PlanFamily,
} from "../plans";
import { usageMonthStart } from "../usage-period";
import {
  FLAGGED_FREE_POOL_USD,
  type SubscriptionTier,
  USAGE_POOL_USD,
  USAGE_UNITS_PER_USD_MICRO,
  usageUnitsToUsd,
  usdToUsageUnits,
  VERIFIED_FREE_POOL_USD,
} from "../usage-pool";
import type { UsageEngineDatabase, UsageEngineLogger, UsageQueryDatabase } from "./database";
import {
  creditOwnerFor as defaultCreditOwnerFor,
  getMaxModeCreditUnits as defaultGetMaxModeCreditUnits,
  type MaxModeCreditOwner,
  spendMaxModeCredits as defaultSpendMaxModeCredits,
} from "./max-mode-credits";
import { type ProductUsageDatabase, recordProductUsage } from "./product-usage-ledger";
import { isSignupFlagged as defaultIsSignupFlagged } from "./signup-risk";
import { canonicalTeamBillingRow } from "./team-billing";

/**
 * Quota row categories. Usage is no longer split by model class: every request
 * (Deni AI chat and Flixa) is recorded on {@link SHARED_USAGE_CATEGORY}. "premium"
 * remains for rows, reservations, and Max Mode meters written before the change.
 */
export type UsageCategory = "basic" | "premium";

export const SHARED_USAGE_CATEGORY: UsageCategory = "basic";
export type { SubscriptionTier };
/**
 * Quota rows count usage units (@deniai/billing): weighted tokens for chat and Flixa,
 * converted provider cost for Deni Run. Rows stored as "tokens" or "requests" before
 * 2026-11 read as a different unit and reset.
 */
export type UsageUnit = "units";
/** The product a reservation's settled amount is recorded for in `product_usage`. */
export type UsageReservationProduct = "chat" | "flixa";
type UsageRecord = typeof usageQuota.$inferSelect;
type UsageDatabase = UsageQueryDatabase;

/** Deni Run's ledger metrics (`product_usage.metric` for product `run`). */
export type RunCostMetric = "model" | "browser" | "computer";

export const RUN_COST_METRICS: readonly RunCostMetric[] = ["model", "browser", "computer"];

/** The shared pool in USD, as Deni Run checks it before and while it works. */
export type RunBudget = {
  tier: SubscriptionTier;
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
  periodEnd: Date;
  poolUsd: { chat: number; flixa: number; run: number };
};

/** An unsettled reservation silent this long is recovered by the usage and meter job. */
export const USAGE_RESERVATION_STALE_MS = 15 * 60_000;

/** A guest's allowance in usage units. It never resets (guest rows have no period end). */
export const GUEST_USAGE_LIMITS: Readonly<Record<UsageCategory, number>> = {
  basic: 1_000_000,
  premium: 0,
};

/** The plan's monthly pool in usage units, shared by chat, Flixa, and Deni Run (@deniai/billing). */
export function getUsagePoolUnits(tier: SubscriptionTier) {
  return usdToUsageUnits(USAGE_POOL_USD[tier]);
}

export class UsageLimitError extends Error {
  public maxModeAvailable: boolean;

  constructor(message: string, maxModeAvailable = false) {
    super(message);
    this.name = "UsageLimitError";
    this.maxModeAvailable = maxModeAvailable;
  }
}

export type TierInfo = {
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
  /** Who pays Max Mode overage with credits: the team on team plans, else the user. */
  creditOwner: MaxModeCreditOwner | null;
  /** Unspent Max Mode credits in usage units; only looked up while Max Mode is on. */
  maxModeCreditUnits: number;
  hasVerifiedPaymentMethod: boolean;
  /** Go at no charge through a verified educational address, without a paid plan. */
  education: boolean;
  /** Free account flagged at sign-up as part of a batch; only looked up for unverified Free accounts. */
  signupFlagged?: boolean;
};

export type UsagePeriod = { unit: UsageUnit; start: Date; end: Date | null };

export type UsageSnapshot = {
  category: UsageCategory;
  unit: UsageUnit;
  limit: number | null;
  used: number;
  remaining: number | null;
  periodStart: Date;
  periodEnd: Date | null;
};

/** The shared monthly pool, in usage units (@deniai/billing); null for guests. */
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
  /** Unspent Max Mode credits ($1 each) of whoever pays overage; null when not eligible. */
  maxModeCredits: number | null;
  hasVerifiedPaymentMethod: boolean;
  /** Go comes free with a verified educational address (no paid plan). */
  education: boolean;
  /**
   * The Free allowance is reduced (see signup-risk.ts) and a verified payment method lifts it.
   * Tells the user the way out without saying what triggered it.
   */
  signupLimited: boolean;
};

/** A summary plus the billing row behind it, for callers that report more than the web app. */
export type UsageSummaryDetails = {
  summary: UsageSummary;
  /** The billing row whose plan applies (the team's canonical row on team plans). */
  billingId: string | null;
  /** The organization of a team plan; null on personal plans and Free. */
  organizationId: string | null;
};

/**
 * Everything the usage engine needs from its host app. Methods are declared as
 * methods so hosts can pass their own (narrower-typed) implementations.
 */
export type UsageEngineDeps = {
  /** Drizzle database over the shared Postgres database (`public` schema). */
  db: UsageEngineDatabase;
  /** Billing turned off for the deployment: Max Mode is unlimited and never charged. */
  billingDisabled?: boolean;
  /** Current time; the default is the wall clock. */
  clock?: () => Date;
  logger?: UsageEngineLogger;
  /**
   * A settlement failed and left its reservation unsettled: ask the host's recovery
   * job (`recoverUsageReservations`) to run no later than `at` (epoch ms).
   */
  scheduleRecovery?(at: number): void;
  /** After credits were spent: top them up if the owner's balance fell below its threshold. */
  autoTopUp?(owner: MaxModeCreditOwner, now: Date): Promise<unknown>;
  /** Plan id to plan family (default: @deniai/billing `getPlanTier`). */
  getPlanTier?(planId: string | null | undefined): PlanFamily | null;
  /** Whether a plan may use Max Mode (default: @deniai/billing `isMaxModeEligible`). */
  isMaxModeEligible?(planId: string | null | undefined): boolean;
  /** Billing statuses whose plan can spend credits (default: `MAX_MODE_USABLE_STATUSES`). */
  maxModeUsableStatuses?: ReadonlySet<string>;
  /** Whether a Free sign-up was flagged (default: a `signup_risk` lookup). */
  isSignupFlagged?(userId: string, database: UsageDatabase): Promise<boolean>;
  /** Max Mode credit lots (default: the `max_mode_credit_lot` implementation in this package). */
  maxModeCredits?: {
    creditOwnerFor(record: {
      userId: string | null;
      organizationId: string | null;
    }): MaxModeCreditOwner | null;
    getCreditUnits(owner: MaxModeCreditOwner, now: Date, database: UsageDatabase): Promise<number>;
    spend(
      owner: MaxModeCreditOwner,
      units: number,
      now: Date,
      database: UsageDatabase,
    ): Promise<number>;
  };
};

/** Thrown inside a dry-run transaction so it always rolls back. */
class DryRunRollback extends Error {
  constructor() {
    super("Usage dry run rolled back.");
    this.name = "DryRunRollback";
  }
}

function getDefaultPeriodEnd(now: Date) {
  const startOfNextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return startOfNextMonth;
}

function resolvePeriodEnd(now: Date) {
  return getDefaultPeriodEnd(now);
}

function isUsageUnit(value: string | null | undefined): value is UsageUnit {
  return value === "units";
}

/** A quota row's usage in the current window (0 once its period or unit has moved on). */
function liveUsed(record: UsageRecord | undefined, now: Date, unit: UsageUnit) {
  if (!record || record.unit !== unit) return 0;
  if (!record.periodEnd || record.periodEnd <= now) return 0;
  return Number(record.used);
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

/**
 * The usage engine shared by Deni AI chat (apps/web) and Flixa (services/agent-api):
 * reservation, settlement, recovery and the usage summary over `usage_quota`,
 * `usage_reservation`, `product_usage` and the Max Mode credit lots. See
 * packages/billing/docs/usage-engine.md.
 */
export function createUsageEngine(deps: UsageEngineDeps) {
  const db = deps.db;
  const isBillingDisabled = deps.billingDisabled ?? false;
  const clock = deps.clock ?? (() => new Date());
  const logger = deps.logger ?? console;
  const getPlanTier = (planId: string | null | undefined) =>
    deps.getPlanTier ? deps.getPlanTier(planId) : defaultGetPlanTier(planId);
  const isMaxModeEligible = (planId: string | null | undefined) =>
    deps.isMaxModeEligible ? deps.isMaxModeEligible(planId) : defaultIsMaxModeEligible(planId);
  const maxModeUsableStatuses = deps.maxModeUsableStatuses ?? MAX_MODE_USABLE_STATUSES;
  const isSignupFlagged = (userId: string, database: UsageDatabase) =>
    deps.isSignupFlagged
      ? deps.isSignupFlagged(userId, database)
      : defaultIsSignupFlagged(userId, database, logger);
  const creditOwnerFor = (record: { userId: string | null; organizationId: string | null }) =>
    deps.maxModeCredits
      ? deps.maxModeCredits.creditOwnerFor(record)
      : defaultCreditOwnerFor(record);
  const getMaxModeCreditUnits = (owner: MaxModeCreditOwner, now: Date, database: UsageDatabase) =>
    deps.maxModeCredits
      ? deps.maxModeCredits.getCreditUnits(owner, now, database)
      : defaultGetMaxModeCreditUnits(owner, now, database);
  const spendMaxModeCredits = (
    owner: MaxModeCreditOwner,
    units: number,
    now: Date,
    database: UsageDatabase,
  ) =>
    deps.maxModeCredits
      ? deps.maxModeCredits.spend(owner, units, now, database)
      : defaultSpendMaxModeCredits(owner, units, now, database);

  /**
   * Run `run` in a transaction holding the user's row lock. With `rollback`, the
   * transaction is always rolled back and `run`'s result returned. It runs at
   * PostgreSQL's default READ COMMITTED: naming the level would add a
   * `SET TRANSACTION` round trip to every call, and chat requests make many.
   */
  async function withUsageLock<T>(
    userId: string,
    run: (database: UsageDatabase) => Promise<T>,
    { rollback = false }: { rollback?: boolean } = {},
  ): Promise<T> {
    if (!rollback) {
      return db.transaction(async (transaction) => {
        // Also protects the empty-quota case and serializes consume/refund across instances.
        await transaction.execute(sql`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`);
        return run(transaction);
      });
    }
    let result: { value: T } | undefined;
    try {
      await db.transaction(async (transaction) => {
        await transaction.execute(sql`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`);
        result = { value: await run(transaction) };
        throw new DryRunRollback();
      });
    } catch (error) {
      if (!(error instanceof DryRunRollback) || !result) throw error;
    }
    return result!.value;
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

  async function getTierInfo(
    userId: string,
    now: Date,
    database: UsageDatabase = db,
  ): Promise<TierInfo> {
    const info = await loadTierInfo(userId, now, database);
    if (info.tier === "free" && !info.hasVerifiedPaymentMethod) {
      info.signupFlagged = await isSignupFlagged(userId, database);
    }
    // Max Mode spends prepaid credits: without any left it cannot carry usage past the pool.
    if (info.maxModeEnabled && info.creditOwner) {
      info.maxModeCreditUnits = isBillingDisabled
        ? Number.MAX_SAFE_INTEGER
        : await getMaxModeCreditUnits(info.creditOwner, now, database);
      info.maxModeEnabled = info.maxModeCreditUnits > 0;
    } else {
      info.maxModeEnabled = false;
    }
    return info;
  }

  /**
   * Whether the account gets Go for free: a verified address on a restricted educational
   * domain (@deniai/billing education rules). It follows the current address, so changing
   * to a non-educational one returns the account to Free.
   */
  async function hasEducationAccess(userId: string, database: UsageDatabase) {
    const [row] = await database
      .select({
        email: user.email,
        emailVerified: user.emailVerified,
        isAnonymous: user.isAnonymous,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return Boolean(row && row.emailVerified && !row.isAnonymous && isEducationalEmail(row.email));
  }

  async function loadTierInfo(
    userId: string,
    now: Date,
    database: UsageDatabase,
  ): Promise<TierInfo> {
    const info = await loadBillingTierInfo(userId, now, database);
    // A paid plan or team plan takes precedence; education only lifts Free to Go.
    if (info.tier === "free" && (await hasEducationAccess(userId, database))) {
      return { ...info, tier: "go", education: true };
    }
    return info;
  }

  async function loadBillingTierInfo(
    userId: string,
    now: Date,
    database: UsageDatabase,
  ): Promise<TierInfo> {
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
          like(billing.planId, "pro_team%"),
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
      const maxModeEligible =
        isMaxModeEligible(teamPlanId) && maxModeUsableStatuses.has(teamStatus ?? "");
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
        tier: "pro",
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
        creditOwner: teamRecord.organizationId
          ? { userId: null, organizationId: teamRecord.organizationId }
          : null,
        maxModeCreditUnits: 0,
        hasVerifiedPaymentMethod,
        education: false,
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
        creditOwner: null,
        maxModeCreditUnits: 0,
        hasVerifiedPaymentMethod,
        education: false,
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
        creditOwner: null,
        maxModeCreditUnits: 0,
        hasVerifiedPaymentMethod,
        education: false,
      };
    }

    const planTier = getPlanTier(planId);
    const maxModeEligible = isMaxModeEligible(planId) && maxModeUsableStatuses.has(status ?? "");

    return {
      billingId: record.id,
      deletionPending: record.deletionPending,
      stripeCustomerId: record.stripeCustomerId,
      tier:
        planTier === "pro" || planTier === "team"
          ? "pro"
          : planTier === "plus"
            ? "plus"
            : planTier === "go"
              ? "go"
              : "free",
      planId,
      status: status ?? null,
      periodEnd: record.currentPeriodEnd ?? null,
      maxModeEnabled: maxModeEligible && record.maxModeEnabled,
      maxModeEligible,
      maxModeMemberEnabled: true,
      maxModeLimitBasic: null,
      maxModeLimitPremium: null,
      creditOwner: { userId, organizationId: null },
      maxModeCreditUnits: 0,
      hasVerifiedPaymentMethod,
      education: false,
    };
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

  /**
   * Reserve quota only. Pending estimates are never written to Stripe's meter.
   *
   * With `dryRun` the whole reservation runs and is rolled back: the result (or the
   * {@link UsageLimitError}) is what a real reservation would have returned, and
   * nothing is written.
   */
  async function consumeUsage({
    userId,
    category,
    reservationId,
    amount = 1,
    now = clock(),
    isAnonymous = false,
    product = "chat",
    dryRun = false,
  }: {
    userId: string;
    category: UsageCategory;
    reservationId: string;
    amount?: number;
    now?: Date;
    isAnonymous?: boolean;
    /** Which product's ledger the settled amount is recorded in. */
    product?: UsageReservationProduct;
    dryRun?: boolean;
  }) {
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new Error("Usage amount must be a positive safe integer.");
    return withUsageLock(
      userId,
      async (database) => {
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
            allowance: null,
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
        // This request's share past the pool must fit the credits left; a member cap
        // bounds the whole period's overage.
        const requestOverage = Math.min(amount, overage);
        if (
          overage > 0 &&
          (!maxModeEnabled ||
            requestOverage > tierInfo.maxModeCreditUnits ||
            (maxModeLimit !== null && overage > maxModeLimit))
        ) {
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
            throw new UsageLimitError(
              "Usage limit reached for your plan.",
              tierInfo.maxModeEligible,
            );
        }
        await database.insert(usageReservation).values({
          id: reservationId,
          userId,
          category,
          product,
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
        // The reservation only holds an estimate. What the request may really spend is
        // what the pool had left, plus the Max Mode credits (within a member cap).
        const creditAllowance = maxModeEnabled
          ? Math.min(
              tierInfo.maxModeCreditUnits,
              maxModeLimit === null
                ? Number.MAX_SAFE_INTEGER
                : Math.max(maxModeLimit - Math.max(state.used - (limit ?? 0), 0), 0),
            )
          : 0;
        return {
          reservationId,
          tier: tierInfo.tier,
          period,
          unit,
          limit,
          remaining: limit === null ? null : Math.max(limit - state.used - amount, 0),
          /** Units this request may spend in total before it must stop; null without a limit. */
          allowance: limit === null ? null : Math.max(limit - state.used, 0) + creditAllowance,
          usedMaxMode: overage > 0,
          maxModeAmount: 0,
        };
      },
      { rollback: dryRun },
    );
  }

  /** Atomically settle actual usage and spend Max Mode credits for what went past the pool. */
  async function settleUsage({
    userId,
    reservationId,
    amount,
    now = clock(),
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
      // The per-product ledger keeps each product's share of the quota chat and Flixa share.
      await recordProductUsage(
        {
          userId,
          product: reservation.product,
          metric: reservation.category,
          unit: period.unit,
          amount,
          at: reservation.createdAt,
        },
        database,
      );
      let creditOwner: MaxModeCreditOwner | null = null;
      if (maxModeAmount > 0) {
        if (!reservation.billingId) throw new Error("Usage reservation has no billing identity.");
        // The plan that carried the request pays: its team's credits, or the user's own.
        const [payer] = await database
          .select({ userId: billing.userId, organizationId: billing.organizationId })
          .from(billing)
          .where(eq(billing.id, reservation.billingId))
          .limit(1);
        creditOwner = payer ? creditOwnerFor(payer) : null;
        // Usage past the credits left is not charged (the next request is refused).
        maxModeAmount = creditOwner
          ? await spendMaxModeCredits(creditOwner, maxModeAmount, now, database)
          : 0;
      }
      await database
        .update(usageReservation)
        .set({ settledAmount: amount, maxModeAmount, settledAt: now })
        .where(eq(usageReservation.id, reservationId));
      return { maxModeAmount, amount, creditOwner };
    }).catch((error: unknown) => {
      // The reservation stays unsettled: have the job recover it once it is stale.
      deps.scheduleRecovery?.(clock().getTime() + USAGE_RESERVATION_STALE_MS);
      throw error;
    });
    if (result.maxModeAmount > 0 && "creditOwner" in result && result.creditOwner) {
      try {
        await deps.autoTopUp?.(result.creditOwner, now);
      } catch (error) {
        logger.error("Max Mode auto top-up check failed", { reservationId, error });
      }
    }
    return { maxModeAmount: result.maxModeAmount, amount: result.amount };
  }

  /** Persist completed provider usage and refresh a running request's recovery lease. */
  async function recordObservedUsage({
    userId,
    reservationId,
    amount,
    now = clock(),
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
  async function recoverUsageReservations(now = clock()) {
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
        logger.error("Usage reservation recovery failed", {
          reservationId: reservation.id,
          error,
        });
        result.recoveryFailed++;
      }
    }
    return result;
  }

  async function summarize({
    userId,
    now = clock(),
    isAnonymous = false,
  }: {
    userId: string;
    now?: Date;
    isAnonymous?: boolean;
  }): Promise<{ summary: UsageSummary; tierInfo: TierInfo }> {
    const nowDate = now;
    const [tierInfo, records, ledger] = await Promise.all([
      getTierInfo(userId, nowDate),
      db.select().from(usageQuota).where(eq(usageQuota.userId, userId)),
      isAnonymous
        ? Promise.resolve({ chat: 0, flixa: 0, run: 0 })
        : monthLedger(userId, nowDate, db),
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
    const maxModeCredits =
      isAnonymous || isBillingDisabled || !tierInfo.maxModeEligible || !tierInfo.creditOwner
        ? null
        : usageUnitsToUsd(
            tierInfo.maxModeEnabled
              ? tierInfo.maxModeCreditUnits
              : await getMaxModeCreditUnits(tierInfo.creditOwner, nowDate, db),
          );

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
      tierInfo,
      summary: {
        tier: tierInfo.tier,
        pool,
        planId: tierInfo.planId,
        status: tierInfo.status,
        periodEnd: tierInfo.periodEnd,
        usage,
        maxModeEnabled: tierInfo.maxModeEnabled,
        maxModeEligible: tierInfo.maxModeEligible,
        maxModeCredits,
        hasVerifiedPaymentMethod: tierInfo.hasVerifiedPaymentMethod,
        education: tierInfo.education,
        signupLimited: Boolean(tierInfo.signupFlagged) && !tierInfo.hasVerifiedPaymentMethod,
      },
    };
  }

  /** The usage the web app shows: the shared pool by product, the plan and Max Mode. */
  async function getUsageSummary(options: {
    userId: string;
    now?: Date;
    isAnonymous?: boolean;
  }): Promise<UsageSummary> {
    return (await summarize(options)).summary;
  }

  /** {@link getUsageSummary} plus the billing row behind it (the agent API reports both). */
  async function getUsageSummaryDetails(options: {
    userId: string;
    now?: Date;
  }): Promise<UsageSummaryDetails> {
    const { summary, tierInfo } = await summarize(options);
    return {
      summary,
      billingId: tierInfo.billingId,
      organizationId: tierInfo.creditOwner?.organizationId ?? null,
    };
  }

  /**
   * The shared pool as Deni Run sees it, in USD: Deni AI chat, Flixa and Deni Run all
   * spend it. Run checks it before starting work and stops once `remainingUsd` is 0.
   */
  async function getRunBudget(userId: string, now = clock()): Promise<RunBudget> {
    const summary = await getUsageSummary({ userId, now });
    const pool = summary.pool;
    const limitUnits = pool?.limit ?? 0;
    const used = pool?.used ?? { chat: 0, flixa: 0, run: 0 };
    const usedUnits = used.chat + used.flixa + used.run;
    return {
      tier: summary.tier,
      periodEnd: pool?.periodEnd ?? resolvePeriodEnd(now),
      limitUsd: usageUnitsToUsd(limitUnits),
      usedUsd: usageUnitsToUsd(usedUnits),
      remainingUsd: usageUnitsToUsd(Math.max(limitUnits - usedUnits, 0)),
      poolUsd: {
        chat: usageUnitsToUsd(used.chat),
        flixa: usageUnitsToUsd(used.flixa),
        run: usageUnitsToUsd(used.run),
      },
    };
  }

  /**
   * Record Deni Run's incurred provider cost (model calls at the reported cost, browser
   * and computer time at their hourly rate) in the product ledger, under the user's
   * usage lock so it serializes with chat and Flixa reservations. Run is charged after
   * the fact, so the pool may overrun by one step; the next budget check refuses work.
   */
  async function recordRunCost({
    userId,
    metric,
    costUsd,
    at = clock(),
  }: {
    userId: string;
    metric: RunCostMetric;
    costUsd: number;
    at?: Date;
  }): Promise<void> {
    if (!Number.isFinite(costUsd) || costUsd < 0)
      throw new Error("Cost must be a nonnegative number.");
    const amount = Math.round(costUsd * 1_000_000);
    if (amount === 0) return;
    await withUsageLock(userId, (database) =>
      recordProductUsage(
        { userId, product: "run", metric, unit: "usd_micros", amount, at },
        database as ProductUsageDatabase,
      ),
    );
  }

  /** The plan tier a (non-guest) user's limits follow, including team plans. */
  async function getSubscriptionTier(userId: string, now = clock()): Promise<SubscriptionTier> {
    return (await loadTierInfo(userId, now, db)).tier;
  }

  /** Whether the account already has Go through education (see `hasEducationAccess`). */
  async function hasEducationGo(userId: string, now = clock()): Promise<boolean> {
    return (await loadTierInfo(userId, now, db)).education;
  }

  async function isFreeAdViewer(userId: string): Promise<boolean> {
    return (await getTierInfo(userId, clock())).tier === "free";
  }

  async function canCompareModels(userId: string): Promise<boolean> {
    const { tier } = await getTierInfo(userId, clock());
    return tier === "pro";
  }

  return {
    consumeUsage,
    settleUsage,
    recordObservedUsage,
    recoverUsageReservations,
    getUsageSummary,
    getUsageSummaryDetails,
    getRunBudget,
    recordRunCost,
    getSubscriptionTier,
    hasEducationGo,
    isFreeAdViewer,
    canCompareModels,
  };
}

export type UsageEngine = ReturnType<typeof createUsageEngine>;
export type UsageReservationResult = Awaited<ReturnType<UsageEngine["consumeUsage"]>>;
