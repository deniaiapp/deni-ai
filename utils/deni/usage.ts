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

/**
 * Atomically reserve one usage unit for the request before it is sent upstream.
 * This prevents concurrent requests from oversubscribing the same quota.
 */
export async function reserveUsageQuota(
  userId: string,
  category: ModelCategory,
  tier: UsageTier,
  hasVerifiedPaymentMethod = false,
): Promise<{
  allowed: boolean;
  remaining: number;
  reserved: boolean;
  unit: UsageUnit;
}> {
  const pool = getDeniPool();
  const now = new Date();
  const periodEnd = getNextMonthFirstDay();
  const limit = getUsageLimit(category, tier, hasVerifiedPaymentMethod);
  const unit = getUsageUnitForTier(tier);

  try {
    // Token-metered tiers do not increment anything at reserve time, so a
    // plain read (no transaction, no row lock) is sufficient. The actual
    // metering happens in recordUsageQuota after the upstream response.
    if (unit !== "requests") {
      const result = await pool.query<
        Pick<
          UsageQuotaRow,
          "used" | "period_end" | "limit_amount" | "plan_tier" | "unit"
        >
      >(
        `SELECT used, period_end, limit_amount, plan_tier, unit
         FROM usage_quota
         WHERE user_id = $1 AND category = $2`,
        [userId, category],
      );

      if (result.rows.length === 0) {
        return { allowed: true, remaining: limit, reserved: false, unit };
      }

      const currentRow = result.rows[0];
      const needsReset = shouldResetUsageRow(currentRow, now, tier, unit);
      const currentUsed = needsReset ? 0 : currentRow.used;

      if (currentUsed >= limit) {
        return { allowed: false, remaining: 0, reserved: false, unit };
      }

      // The actual reset happens lazily in recordUsageQuota; no write needed
      // on the request hot path.
      return {
        allowed: true,
        remaining: Math.max(limit - currentUsed, 0),
        reserved: false,
        unit,
      };
    }

    // Request-metered tiers use one atomic upsert. Besides removing the
    // BEGIN/SELECT FOR UPDATE/UPDATE/COMMIT round trips, this also handles
    // concurrent first requests without a unique-violation race.
    const result = await pool.query<Pick<UsageQuotaRow, "used">>(
      `INSERT INTO usage_quota
         (user_id, category, plan_tier, limit_amount, unit, used, period_start, period_end)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7)
       ON CONFLICT (user_id, category) DO UPDATE
       SET used = CASE
             WHEN (usage_quota.period_end IS NOT NULL AND usage_quota.period_end <= EXCLUDED.period_start)
                  OR usage_quota.plan_tier IS DISTINCT FROM EXCLUDED.plan_tier
                  OR usage_quota.unit IS DISTINCT FROM EXCLUDED.unit
               THEN 1
             ELSE usage_quota.used + 1
           END,
           plan_tier = EXCLUDED.plan_tier,
           limit_amount = EXCLUDED.limit_amount,
           unit = EXCLUDED.unit,
           period_start = CASE
             WHEN (usage_quota.period_end IS NOT NULL AND usage_quota.period_end <= EXCLUDED.period_start)
                  OR usage_quota.plan_tier IS DISTINCT FROM EXCLUDED.plan_tier
                  OR usage_quota.unit IS DISTINCT FROM EXCLUDED.unit
               THEN EXCLUDED.period_start
             ELSE usage_quota.period_start
           END,
           period_end = CASE
             WHEN (usage_quota.period_end IS NOT NULL AND usage_quota.period_end <= EXCLUDED.period_start)
                  OR usage_quota.plan_tier IS DISTINCT FROM EXCLUDED.plan_tier
                  OR usage_quota.unit IS DISTINCT FROM EXCLUDED.unit
               THEN EXCLUDED.period_end
             ELSE usage_quota.period_end
           END
       WHERE CASE
               WHEN (usage_quota.period_end IS NOT NULL AND usage_quota.period_end <= EXCLUDED.period_start)
                    OR usage_quota.plan_tier IS DISTINCT FROM EXCLUDED.plan_tier
                    OR usage_quota.unit IS DISTINCT FROM EXCLUDED.unit
                 THEN 0
               ELSE usage_quota.used
             END < EXCLUDED.limit_amount
       RETURNING used`,
      [userId, category, tier, limit, unit, now, periodEnd],
    );

    const used = result.rows[0]?.used;
    if (used === undefined) {
      return { allowed: false, remaining: 0, reserved: false, unit };
    }

    return {
      allowed: true,
      remaining: Math.max(limit - used, 0),
      reserved: true,
      unit,
    };
  } catch (error) {
    console.error(
      `[Usage] Failed to reserve usage for user=${userId} category=${category}:`,
      error,
    );
    throw error;
  }
}

/**
 * Record usage after an upstream request succeeds. Paid tiers are tracked in tokens.
 */
export async function recordUsageQuota(
  userId: string,
  category: ModelCategory,
  tier: UsageTier,
  amount: number,
  hasVerifiedPaymentMethod = false,
): Promise<void> {
  if (
    getUsageUnitForTier(tier) !== "tokens" ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return;
  }

  const pool = getDeniPool();
  const now = new Date();
  const periodEnd = getNextMonthFirstDay();
  const limit = getUsageLimit(category, tier, hasVerifiedPaymentMethod);
  const unit = getUsageUnitForTier(tier);

  try {
    // One atomic upsert handles first-use creation, period resets, and
    // concurrent increments without a preliminary UPDATE/INSERT race.
    await pool.query(
      `INSERT INTO usage_quota
         (user_id, category, plan_tier, limit_amount, unit, used, period_start, period_end)
       VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, $8)
       ON CONFLICT (user_id, category) DO UPDATE
       SET used = CASE
             WHEN (usage_quota.period_end IS NOT NULL AND usage_quota.period_end <= EXCLUDED.period_start)
                  OR usage_quota.plan_tier IS DISTINCT FROM EXCLUDED.plan_tier
                  OR usage_quota.unit IS DISTINCT FROM EXCLUDED.unit
               THEN EXCLUDED.used
             ELSE usage_quota.used + EXCLUDED.used
           END,
           period_start = CASE
             WHEN (usage_quota.period_end IS NOT NULL AND usage_quota.period_end <= EXCLUDED.period_start)
                  OR usage_quota.plan_tier IS DISTINCT FROM EXCLUDED.plan_tier
                  OR usage_quota.unit IS DISTINCT FROM EXCLUDED.unit
               THEN EXCLUDED.period_start
             ELSE usage_quota.period_start
           END,
           period_end = CASE
             WHEN (usage_quota.period_end IS NOT NULL AND usage_quota.period_end <= EXCLUDED.period_start)
                  OR usage_quota.plan_tier IS DISTINCT FROM EXCLUDED.plan_tier
                  OR usage_quota.unit IS DISTINCT FROM EXCLUDED.unit
               THEN EXCLUDED.period_end
             ELSE usage_quota.period_end
           END,
           plan_tier = EXCLUDED.plan_tier,
           limit_amount = EXCLUDED.limit_amount,
           unit = EXCLUDED.unit`,
      [userId, category, tier, limit, unit, amount, now, periodEnd],
    );
  } catch (error) {
    console.error(
      `[Usage] Failed to record usage for user=${userId} category=${category}:`,
      error,
    );
    throw error;
  }
}

/**
 * Release one reserved usage unit after an upstream request fails before producing
 * a successful response for the client. Free tier is tracked in requests.
 */
export async function releaseUsageQuota(
  userId: string,
  category: ModelCategory,
  tier: UsageTier,
): Promise<void> {
  if (getUsageUnitForTier(tier) !== "requests") {
    return;
  }

  const pool = getDeniPool();

  try {
    await pool.query(
      `UPDATE usage_quota
       SET used = GREATEST(used - 1, 0)
       WHERE user_id = $1 AND category = $2`,
      [userId, category],
    );
  } catch (error) {
    console.error(
      `[Usage] Failed to release usage for user=${userId} category=${category}:`,
      error,
    );
  }
}
