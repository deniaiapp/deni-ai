import {
  FLAGGED_FREE_POOL_USD,
  isEducationalEmail,
  USAGE_POOL_USD,
  USAGE_UNITS_PER_USD,
  USAGE_UNITS_PER_USD_MICRO,
  VERIFIED_FREE_POOL_USD,
  type SubscriptionTier,
} from "@deniai/billing";
import { getDeniPool } from "./db";
import type { DeniUsageInfo, BillingRow, UsageQuotaRow } from "./types";
import type { ModelCategory } from "./models";

export type UsageTier = SubscriptionTier;
/** The only quota unit: pool usage units (1M units = $0.50). */
export type UsageUnit = "units";

// Active billing statuses
const ACTIVE_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "incomplete",
  "unpaid",
  "paid",
];

const BILLING_PRIORITY_ORDER = `CASE
  WHEN status IN ('active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paid') THEN 0
  WHEN status = 'canceled' AND current_period_end IS NOT NULL AND current_period_end > NOW() THEN 1
  ELSE 2
END`;

// One monthly pool per plan, shared by Deni AI chat, Flixa, and Deni Run
// (@deniai/billing): the pool is priced in USD, and weighted tokens and Deni Run's
// cost (product_usage, product 'run', in micro-dollars) are both counted in usage
// units (1M units = $0.50).

export const USAGE_UNIT: UsageUnit = "units";

function getPoolUnits(
  tier: UsageTier,
  hasVerifiedPaymentMethod: boolean,
  signupFlagged: boolean,
): number {
  if (tier === "free" && hasVerifiedPaymentMethod) {
    return VERIFIED_FREE_POOL_USD * USAGE_UNITS_PER_USD;
  }
  if (tier === "free" && signupFlagged) {
    return FLAGGED_FREE_POOL_USD * USAGE_UNITS_PER_USD;
  }
  return USAGE_POOL_USD[tier] * USAGE_UNITS_PER_USD;
}

interface PoolUsage {
  /** Current-period usage per quota category, in units. */
  quota: Record<ModelCategory, number>;
  /** Deni Run's spend this month, in units. */
  run: number;
  signupFlagged: boolean;
}

/** Everything that draws on the shared pool this month, read in one round trip. */
async function getPoolUsage(userId: string): Promise<PoolUsage> {
  const result = await getDeniPool().query<{
    basic: string | number;
    premium: string | number;
    run_micros: string | number;
    flagged: boolean;
  }>(
    `SELECT
       COALESCE((SELECT SUM(used) FROM usage_quota WHERE user_id = $1 AND category = 'basic'
         AND unit = 'units' AND period_end IS NOT NULL AND period_end > NOW()), 0) AS basic,
       COALESCE((SELECT SUM(used) FROM usage_quota WHERE user_id = $1 AND category = 'premium'
         AND unit = 'units' AND period_end IS NOT NULL AND period_end > NOW()), 0) AS premium,
       COALESCE((SELECT SUM(used) FROM product_usage WHERE user_id = $1 AND product = 'run'
         AND unit = 'usd_micros'
         AND period_start = date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)
         AS run_micros,
       EXISTS (SELECT 1 FROM signup_risk WHERE user_id = $1) AS flagged`,
    [userId],
  );
  const row = result.rows[0];
  return {
    quota: { basic: Number(row?.basic ?? 0), premium: Number(row?.premium ?? 0) },
    run: Math.round(Number(row?.run_micros ?? 0) * USAGE_UNITS_PER_USD_MICRO),
    signupFlagged: Boolean(row?.flagged),
  };
}

/** What the pool leaves for one category after the other category and Deni Run. */
async function getCategoryLimit(
  userId: string,
  category: ModelCategory,
  tier: UsageTier,
  hasVerifiedPaymentMethod: boolean,
): Promise<number> {
  const usage = await getPoolUsage(userId);
  const other = category === "basic" ? usage.quota.premium : usage.quota.basic;
  const pool = getPoolUnits(tier, hasVerifiedPaymentMethod, usage.signupFlagged);
  return Math.max(pool - other - usage.run, 0);
}

function getWebBaseUrl(): string {
  const baseUrl =
    process.env.DENI_WEB_BASE_URL ??
    process.env.FLIXA_WEB_BASE_URL ??
    process.env.WEB_BASE_URL ??
    "https://deniai.app";

  return baseUrl.replace(/\/+$/, "");
}

function buildWebUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${getWebBaseUrl()}${path}`;
}

export function getVerifyUrl(): string {
  return buildWebUrl(process.env.DENI_VERIFY_PATH ?? "/settings/billing");
}

export function getUpgradeUrl(): string {
  return buildWebUrl(process.env.DENI_UPGRADE_PATH ?? "/settings/billing");
}

function shouldResetUsageRow(
  quotaRow: Pick<UsageQuotaRow, "period_end" | "plan_tier" | "unit">,
  now: Date,
  tier: UsageTier,
): boolean {
  const isPeriodExpired =
    quotaRow.period_end && new Date(quotaRow.period_end) <= now;
  const hasTierChanged = quotaRow.plan_tier !== tier;
  const hasUnitChanged = quotaRow.unit !== USAGE_UNIT;
  return Boolean(isPeriodExpired || hasTierChanged || hasUnitChanged);
}

/**
 * Get the first day of next month in UTC
 */
function getNextMonthFirstDay(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
}

/**
 * Determine tier from billing info
 */
function determineTier(billing: BillingRow | null, isTeam: boolean): UsageTier {
  if (!billing) return "free";

  const { plan_id, status, current_period_end } = billing;

  // Check if billing is active
  const isActiveStatus = ACTIVE_STATUSES.includes(status);
  const isInGracePeriod =
    status === "canceled" &&
    current_period_end &&
    new Date(current_period_end) > new Date();
  const isActive = isActiveStatus || isInGracePeriod;

  if (!isActive) return "free";

  // Team billing (Pro for Teams) is pro.
  if (isTeam) return "pro";

  // Personal billing: check plan_id. Removed Max plans (max_*) fall back to free.
  if (plan_id?.startsWith("pro")) return "pro";
  if (plan_id?.startsWith("plus")) return "plus";
  if (plan_id?.startsWith("go_")) return "go";
  return "free";
}

interface BillingProfile {
  billing: BillingRow | null;
  isTeam: boolean;
  tier: UsageTier;
  hasVerifiedPaymentMethod: boolean;
}

function getBillingCacheTtlMs(): number {
  const raw = process.env.FLIXA_BILLING_CACHE_TTL_MS;
  if (!raw) return 60_000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60_000;
}

const BILLING_CACHE_TTL_MS = getBillingCacheTtlMs();
const BILLING_CACHE_MAX_ENTRIES = 10_000;
const billingProfileCache = new Map<
  string,
  { profile: BillingProfile; expiresAt: number }
>();
const billingProfileInFlight = new Map<string, Promise<BillingProfile>>();

async function hasEducationAccess(userId: string): Promise<boolean> {
  const result = await getDeniPool().query<{
    email: string;
    email_verified: boolean;
    is_anonymous: boolean | null;
  }>(
    `SELECT email, email_verified, is_anonymous FROM "user" WHERE id = $1`,
    [userId],
  );
  const row = result.rows[0];
  return Boolean(
    row && row.email_verified && !row.is_anonymous && isEducationalEmail(row.email),
  );
}

/**
 * Fetch the user's billing rows and derive tier info.
 * Team and personal billing are selected in one query; no usage rows.
 */
async function fetchBillingProfile(userId: string): Promise<BillingProfile> {
  const pool = getDeniPool();

  // Fetch the highest-priority team and personal rows in one round trip. The
  // old sequential pair of queries made every billing-cache miss pay two DB
  // network round trips before quota checking could begin.
  const billingResult = await pool.query<
    BillingRow & { is_team: boolean }
  >(
    `WITH team_billing AS (
       SELECT b.plan_id, b.status, b.current_period_end, b.max_mode_enabled,
              b.payment_method_fingerprint, b.card_verified_at,
              TRUE AS is_team
       FROM billing b
       INNER JOIN member m ON b.organization_id = m.organization_id
       WHERE m.user_id = $1
         AND b.organization_id IS NOT NULL
         AND b.plan_id LIKE 'pro_team%'
       ORDER BY ${BILLING_PRIORITY_ORDER.replaceAll("status", "b.status").replaceAll("current_period_end", "b.current_period_end")}, b.current_period_end DESC NULLS LAST
       LIMIT 1
     ), personal_billing AS (
       SELECT plan_id, status, current_period_end, max_mode_enabled,
              payment_method_fingerprint, card_verified_at,
              FALSE AS is_team
       FROM billing
       WHERE user_id = $1 AND organization_id IS NULL
       ORDER BY ${BILLING_PRIORITY_ORDER}, current_period_end DESC NULLS LAST
       LIMIT 1
     )
     SELECT * FROM team_billing
     UNION ALL
     SELECT * FROM personal_billing`,
    [userId],
  );

  const teamBilling = billingResult.rows.find((row) => row.is_team);
  const personalBilling = billingResult.rows.find((row) => !row.is_team);

  // Determine which billing to use
  let billing: BillingRow | null = null;
  let isTeam = false;

  if (teamBilling) {
    const isActiveStatus = ACTIVE_STATUSES.includes(teamBilling.status);
    const isInGracePeriod =
      teamBilling.status === "canceled" &&
      teamBilling.current_period_end &&
      new Date(teamBilling.current_period_end) > new Date();

    if (isActiveStatus || isInGracePeriod) {
      billing = teamBilling;
      isTeam = true;
    }
  }

  // Fallback to personal billing if no active team billing
  if (!billing && personalBilling) {
    billing = personalBilling;
  }

  let tier = determineTier(billing, isTeam);
  // A verified educational address lifts Free to Go at no charge (same rule as
  // deni-ai's loadTierInfo); paid and team plans take precedence.
  if (tier === "free" && (await hasEducationAccess(userId))) tier = "go";
  const hasVerifiedPaymentMethod =
    billing?.payment_method_fingerprint !== null &&
    billing?.payment_method_fingerprint !== undefined;

  return { billing, isTeam, tier, hasVerifiedPaymentMethod };
}

/**
 * Billing profile with a short TTL cache. Billing tier changes are rare, so
 * caching saves two queries per agent request on hot users. Plan changes take
 * effect within BILLING_CACHE_TTL_MS.
 */
export async function getDeniBillingProfile(
  userId: string,
): Promise<BillingProfile> {
  if (BILLING_CACHE_TTL_MS > 0) {
    const cached = billingProfileCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.profile;
    }
  }

  const existing = billingProfileInFlight.get(userId);
  if (existing) return existing;

  const pending = fetchBillingProfile(userId).then((profile) => {
    if (BILLING_CACHE_TTL_MS > 0) {
      if (billingProfileCache.size >= BILLING_CACHE_MAX_ENTRIES) {
        billingProfileCache.clear();
      }
      billingProfileCache.set(userId, {
        profile,
        expiresAt: Date.now() + BILLING_CACHE_TTL_MS,
      });
    }
    return profile;
  });

  billingProfileInFlight.set(userId, pending);
  void pending.then(
    () => {
      if (billingProfileInFlight.get(userId) === pending) {
        billingProfileInFlight.delete(userId);
      }
    },
    () => {
      if (billingProfileInFlight.get(userId) === pending) {
        billingProfileInFlight.delete(userId);
      }
    },
  );

  return pending;
}

/**
 * Legacy `GET /v1/deni/usage` (`FLIXA_USAGE_ENGINE=legacy`/`shadow`): the user's plan
 * info, usage, and remaining quota. `shared` mode reports the shared engine's summary
 * (`getSharedDeniUsageInfo` in flixaUsage.ts).
 */
export async function getDeniUsageInfo(userId: string): Promise<DeniUsageInfo> {
  const pool = getDeniPool();
  const [billingProfile, usageResult, poolUsage] = await Promise.all([
    getDeniBillingProfile(userId),
    pool.query<UsageQuotaRow>(
      `SELECT category, plan_tier, limit_amount, unit, used, period_start, period_end
       FROM usage_quota
       WHERE user_id = $1`,
      [userId],
    ),
    getPoolUsage(userId),
  ]);
  const { billing, isTeam, tier, hasVerifiedPaymentMethod } = billingProfile;
  const poolLimit = getPoolUnits(tier, hasVerifiedPaymentMethod, poolUsage.signupFlagged);

  // Determine Max Mode eligibility
  const maxModeEligible =
    billing?.plan_id?.startsWith("pro") === true && billing.status === "active";
  const maxModeEnabled =
    maxModeEligible && (billing?.max_mode_enabled ?? false);

  // Determine period end
  const periodEnd: string | null = getNextMonthFirstDay().toISOString();

  const now = new Date();
  const defaultPeriodEnd = getNextMonthFirstDay().toISOString();
  const unit = USAGE_UNIT;
  const usage: DeniUsageInfo["usage"] = [];

  // Usage is not split by model class. Both entries report the one pool and its total
  // use; the "premium" entry is kept so older extension and CLI versions keep working.
  const quotaUsed = (category: ModelCategory) => {
    const row = usageResult.rows.find((r) => r.category === category);
    return row && !shouldResetUsageRow(row, now, tier) ? Number(row.used) : 0;
  };
  const totalUsed = quotaUsed("basic") + quotaUsed("premium") + poolUsage.run;
  for (const category of ["basic", "premium"] as const) {
    const quotaRow = usageResult.rows.find((r) => r.category === category);
    const current = quotaRow && !shouldResetUsageRow(quotaRow, now, tier);
    usage.push({
      category,
      unit,
      limit: poolLimit,
      used: totalUsed,
      remaining: Math.max(poolLimit - totalUsed, 0),
      periodStart: current ? new Date(quotaRow.period_start).toISOString() : now.toISOString(),
      periodEnd: current
        ? quotaRow.period_end
          ? new Date(quotaRow.period_end).toISOString()
          : null
        : defaultPeriodEnd,
    });
  }

  return {
    tier,
    hasVerifiedPaymentMethod,
    cardVerifiedAt: billing?.card_verified_at
      ? new Date(billing.card_verified_at).toISOString()
      : null,
    verifyUrl: getVerifyUrl(),
    upgradeUrl: getUpgradeUrl(),
    isTeam,
    planId: billing?.plan_id ?? null,
    status: billing?.status ?? null,
    periodEnd,
    maxModeEnabled,
    maxModeEligible,
    usage,
    pool: {
      limit: poolLimit,
      used: totalUsed,
      remaining: Math.max(poolLimit - totalUsed, 0),
      periodEnd: defaultPeriodEnd,
    },
  };
}

export interface UsageReservation {
  id: string;
  amount: number;
  userId: string;
  category: ModelCategory;
}

/** Legacy path (`FLIXA_USAGE_ENGINE=legacy`/`shadow`): reserve estimated usage units
 * (weighted tokens), including concurrent first requests. The quota update and receipt
 * (flixa.usage_reservation, deprecated, see @deniai/db/flixa) are one atomic PostgreSQL
 * statement. The default `shared` mode reserves through `@deniai/billing/server`
 * instead (flixaUsage.ts).
 */
export async function reserveUsageQuota(
  userId: string,
  category: ModelCategory,
  tier: UsageTier,
  hasVerifiedPaymentMethod = false,
  amount = 1,
): Promise<{
  allowed: boolean;
  remaining: number;
  reserved: boolean;
  unit: UsageUnit;
  reservation?: UsageReservation;
}> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Usage reservation must be a positive safe integer");
  }
  const limit = await getCategoryLimit(userId, category, tier, hasVerifiedPaymentMethod);
  const unit = USAGE_UNIT;
  if (amount > limit) return { allowed: false, remaining: limit, reserved: false, unit };
  const id = crypto.randomUUID();
  const now = new Date();
  const reset = `(usage_quota.period_end IS NOT NULL AND usage_quota.period_end <= EXCLUDED.period_start)
    OR usage_quota.plan_tier IS DISTINCT FROM EXCLUDED.plan_tier
    OR usage_quota.unit IS DISTINCT FROM EXCLUDED.unit`;
  const result = await getDeniPool().query<{ used: string | number }>(
    `WITH reserved AS (
       INSERT INTO usage_quota
         (user_id, category, plan_tier, limit_amount, unit, used, period_start, period_end)
       VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, $8)
       ON CONFLICT (user_id, category) DO UPDATE
       SET used = CASE WHEN ${reset} THEN EXCLUDED.used ELSE usage_quota.used + EXCLUDED.used END,
           period_start = CASE WHEN ${reset} THEN EXCLUDED.period_start ELSE usage_quota.period_start END,
           period_end = CASE WHEN ${reset} THEN EXCLUDED.period_end ELSE usage_quota.period_end END,
           plan_tier = EXCLUDED.plan_tier,
           limit_amount = EXCLUDED.limit_amount,
           unit = EXCLUDED.unit
       WHERE (CASE WHEN ${reset} THEN 0 ELSE usage_quota.used END) + EXCLUDED.used <= EXCLUDED.limit_amount
       RETURNING used, period_start
     ), receipt AS (
       INSERT INTO flixa.usage_reservation (id, user_id, category, plan_tier, period_start, amount)
       SELECT $9::uuid, $1::text, $2::text, $3::text, EXTRACT(EPOCH FROM period_start)::text, $6::bigint FROM reserved
       RETURNING id
     ) SELECT used FROM reserved, receipt`,
    [userId, category, tier, limit, unit, amount, now, getNextMonthFirstDay(), id],
  );
  if (!result.rows.length) return { allowed: false, remaining: 0, reserved: false, unit };
  return {
    allowed: true,
    remaining: Math.max(0, limit - Number(result.rows[0].used)),
    reserved: true,
    unit,
    reservation: { id, amount, userId, category },
  };
}

/** Legacy path: exactly-once adjustment, even if cancellation and completion race or retry.
 * Older receipts cannot subtract from a newly reset billing period/tier.
 * On DB failure the reservation remains charged and available for retry/audit.
 */
export async function settleUsageQuota(
  reservation: UsageReservation,
  actualAmount: number,
): Promise<void> {
  if (!Number.isSafeInteger(actualAmount) || actualAmount < 0) {
    throw new Error("Actual usage must be a non-negative safe integer");
  }
  // The product_usage row (owned by Deni AI's schema) records Flixa's share of
  // the quota it shares with Deni AI chat, for the combined usage view. It is
  // written from the same deleted receipt, so it is counted exactly once.
  await getDeniPool().query(
    `WITH receipt AS (
       DELETE FROM flixa.usage_reservation WHERE id = $1::uuid
       RETURNING user_id, category, plan_tier, period_start, amount, created_at
     ), quota AS (
       UPDATE usage_quota q
       SET used = GREATEST(0, q.used - receipt.amount + $2::bigint)
       FROM receipt
       WHERE q.user_id = $3 AND q.category = $4
         AND q.user_id::text = receipt.user_id AND q.category::text = receipt.category
         AND q.plan_tier::text = receipt.plan_tier AND q.unit = 'units'
         AND EXTRACT(EPOCH FROM q.period_start)::text = receipt.period_start
       RETURNING q.user_id
     )
     INSERT INTO product_usage (user_id, product, metric, unit, period_start, used)
     SELECT receipt.user_id, 'flixa', receipt.category, 'units',
            date_trunc('month', receipt.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
            $2::bigint
     FROM receipt
     WHERE $2::bigint > 0
     ON CONFLICT (user_id, product, metric, unit, period_start)
     DO UPDATE SET used = product_usage.used + EXCLUDED.used, updated_at = NOW()`,
    [reservation.id, actualAmount, reservation.userId, reservation.category],
  );
}
