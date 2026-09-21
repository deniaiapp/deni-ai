import { getDeniPool } from "./db";
import type { DeniUsageInfo, BillingRow, UsageQuotaRow } from "./types";
import type { ModelCategory } from "./models";

export type UsageTier = "free" | "plus" | "pro" | "max";
export type UsageUnit = "requests" | "tokens";

// Active billing statuses
const ACTIVE_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "incomplete",
  "unpaid",
  "paid",
];

const MAX_TEAM_PLAN_IDS = ["max_team_monthly", "max_team_yearly"] as const;

const BILLING_PRIORITY_ORDER = `CASE
  WHEN status IN ('active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paid') THEN 0
  WHEN status = 'canceled' AND current_period_end IS NOT NULL AND current_period_end > NOW() THEN 1
  ELSE 2
END`;

// Tier-based usage limits
const TIER_LIMITS = {
  free: { unit: "tokens", basic: 10_000_000, premium: 1_000_000 },
  plus: { unit: "tokens", basic: 150_000_000, premium: 50_000_000 },
  pro: { unit: "tokens", basic: 300_000_000, premium: 150_000_000 },
  max: { unit: "tokens", basic: 800_000_000, premium: 450_000_000 },
} as const;

const VERIFIED_FREE_LIMITS = {
  basic: 25_000_000,
  premium: 2_000_000,
} as const;

export function getUsageUnitForTier(tier: UsageTier): UsageUnit {
  return TIER_LIMITS[tier].unit;
}

function getUsageLimit(
  category: ModelCategory,
  tier: UsageTier,
  hasVerifiedPaymentMethod = false,
): number {
  if (tier === "free" && hasVerifiedPaymentMethod) {
    return VERIFIED_FREE_LIMITS[category];
  }

  return TIER_LIMITS[tier][category];
}

function getWebBaseUrl(): string {
  const baseUrl =
    Bun.env.DENI_WEB_BASE_URL ??
    Bun.env.FLIXA_WEB_BASE_URL ??
    Bun.env.WEB_BASE_URL ??
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
  return buildWebUrl(Bun.env.DENI_VERIFY_PATH ?? "/settings/billing");
}

export function getUpgradeUrl(): string {
  return buildWebUrl(Bun.env.DENI_UPGRADE_PATH ?? "/settings/billing");
}

function shouldResetUsageRow(
  quotaRow: Pick<UsageQuotaRow, "period_end" | "plan_tier" | "unit">,
  now: Date,
  tier: UsageTier,
  unit: UsageUnit,
): boolean {
  const isPeriodExpired =
    quotaRow.period_end && new Date(quotaRow.period_end) <= now;
  const hasTierChanged = quotaRow.plan_tier !== tier;
  const hasUnitChanged = quotaRow.unit !== unit;
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

  // Team billing is pro by default, except for Max Teams plans.
  if (isTeam) {
    return MAX_TEAM_PLAN_IDS.some((maxTeamPlanId) => maxTeamPlanId === plan_id)
      ? "max"
      : "pro";
  }

  // Personal billing: check plan_id
  if (plan_id?.startsWith("pro")) return "pro";
  if (plan_id?.startsWith("max")) return "max";
  if (plan_id?.startsWith("plus")) return "plus";
  return "free";
}

interface BillingProfile {
  billing: BillingRow | null;
  isTeam: boolean;
  tier: UsageTier;
  hasVerifiedPaymentMethod: boolean;
}

function getBillingCacheTtlMs(): number {
  const raw = Bun.env.FLIXA_BILLING_CACHE_TTL_MS;
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
              b.payment_method_fingerprint, b.card_funding, b.card_verified_at,
              TRUE AS is_team
       FROM billing b
       INNER JOIN member m ON b.organization_id = m.organization_id
       WHERE m.user_id = $1
         AND b.organization_id IS NOT NULL
         AND (
           b.plan_id LIKE 'pro_team%'
           OR b.plan_id IN ('max_team_monthly', 'max_team_yearly')
         )
       ORDER BY ${BILLING_PRIORITY_ORDER.replaceAll("status", "b.status").replaceAll("current_period_end", "b.current_period_end")}, b.current_period_end DESC NULLS LAST
       LIMIT 1
     ), personal_billing AS (
       SELECT plan_id, status, current_period_end, max_mode_enabled,
              payment_method_fingerprint, card_funding, card_verified_at,
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

  const tier = determineTier(billing, isTeam);
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
 * Fetch Deni AI user's plan info, usage, and remaining quota
 */
export async function getDeniUsageInfo(userId: string): Promise<DeniUsageInfo> {
  const pool = getDeniPool();
  const [billingProfile, usageResult] = await Promise.all([
    getDeniBillingProfile(userId),
    pool.query<UsageQuotaRow>(
      `SELECT category, plan_tier, limit_amount, unit, used, period_start, period_end
       FROM usage_quota
       WHERE user_id = $1`,
      [userId],
    ),
  ]);
  const { billing, isTeam, tier, hasVerifiedPaymentMethod } = billingProfile;

  // Determine Max Mode eligibility
  const maxModeEligible =
    billing?.plan_id?.startsWith("pro") === true && billing.status === "active";
  const maxModeEnabled =
    maxModeEligible && (billing?.max_mode_enabled ?? false);

  // Determine period end
  const periodEnd: string | null = getNextMonthFirstDay().toISOString();

  const now = new Date();
  const defaultPeriodEnd = getNextMonthFirstDay().toISOString();
  const unit = getUsageUnitForTier(tier);
  const usage: DeniUsageInfo["usage"] = [];

  // Process each category
  for (const category of ["basic", "premium"] as const) {
    const quotaRow = usageResult.rows.find((r) => r.category === category);
    const limit = getUsageLimit(category, tier, hasVerifiedPaymentMethod);

    if (quotaRow) {
      const needsReset = shouldResetUsageRow(quotaRow, now, tier, unit);
      const used = needsReset ? 0 : quotaRow.used;
      const remaining = Math.max(limit - used, 0);

      usage.push({
        category,
        unit,
        limit,
        used,
        remaining,
        periodStart: needsReset
          ? now.toISOString()
          : new Date(quotaRow.period_start).toISOString(),
        periodEnd: needsReset
          ? defaultPeriodEnd
          : quotaRow.period_end
            ? new Date(quotaRow.period_end).toISOString()
            : null,
      });
    } else {
      usage.push({
        category,
        unit,
        limit,
        used: 0,
        remaining: limit,
        periodStart: now.toISOString(),
        periodEnd: defaultPeriodEnd,
      });
    }
  }

  return {
    tier,
    hasVerifiedPaymentMethod,
    cardVerifiedAt: billing?.card_verified_at
      ? new Date(billing.card_verified_at).toISOString()
      : null,
    cardFunding: billing?.card_funding ?? null,
    verifyUrl: getVerifyUrl(),
    upgradeUrl: getUpgradeUrl(),
    isTeam,
    planId: billing?.plan_id ?? null,
    status: billing?.status ?? null,
    periodEnd,
    maxModeEnabled,
    maxModeEligible,
    usage,
  };
}

export interface UsageReservation {
  id: string;
  amount: number;
  userId: string;
  category: ModelCategory;
}

let reservationTableReady: Promise<void> | undefined;

async function ensureReservationTable(): Promise<void> {
  reservationTableReady ??= getDeniPool().query(`
    CREATE TABLE IF NOT EXISTS flixa_usage_reservation (
      id UUID PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      plan_tier TEXT NOT NULL,
      period_start TEXT NOT NULL,
      amount BIGINT NOT NULL CHECK (amount > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).then(() => {}).catch((error) => {
    reservationTableReady = undefined;
    throw error;
  });
  await reservationTableReady;
}

/** Reserve estimated weighted tokens, including concurrent first requests.
 * The quota update and receipt creation are one atomic PostgreSQL statement.
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
  const limit = getUsageLimit(category, tier, hasVerifiedPaymentMethod);
  const unit = getUsageUnitForTier(tier);
  if (amount > limit) return { allowed: false, remaining: limit, reserved: false, unit };
  await ensureReservationTable();
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
       INSERT INTO flixa_usage_reservation (id, user_id, category, plan_tier, period_start, amount)
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

/** Exactly-once adjustment, even if cancellation and completion race or retry.
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
  await getDeniPool().query(
    `WITH receipt AS (
       DELETE FROM flixa_usage_reservation WHERE id = $1::uuid
       RETURNING user_id, category, plan_tier, period_start, amount
     )
     UPDATE usage_quota q
     SET used = GREATEST(0, q.used - receipt.amount + $2::bigint)
     FROM receipt
     WHERE q.user_id = $3 AND q.category = $4
       AND q.user_id::text = receipt.user_id AND q.category::text = receipt.category
       AND q.plan_tier::text = receipt.plan_tier AND q.unit = 'tokens'
       AND EXTRACT(EPOCH FROM q.period_start)::text = receipt.period_start`,
    [reservation.id, actualAmount, reservation.userId, reservation.category],
  );
}
