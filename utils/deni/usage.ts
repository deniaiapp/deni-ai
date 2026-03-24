import { getDeniPool } from './db';
import type { DeniUsageInfo, BillingRow, UsageQuotaRow } from './types';
import type { ModelCategory } from './models';

export type UsageTier = 'free' | 'plus' | 'pro' | 'max';
export type UsageUnit = 'requests' | 'tokens';

// Active billing statuses
const ACTIVE_STATUSES = ['active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paid'];

const BILLING_PRIORITY_ORDER = `CASE
  WHEN status IN ('active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paid') THEN 0
  WHEN status = 'canceled' AND current_period_end IS NOT NULL AND current_period_end > NOW() THEN 1
  ELSE 2
END`;

// Tier-based usage limits
const TIER_LIMITS = {
  free: { unit: 'requests', basic: 500, premium: 50 },
  plus: { unit: 'tokens', basic: 20_000_000, premium: 5_000_000 },
  pro: { unit: 'tokens', basic: 50_000_000, premium: 15_000_000 },
  max: { unit: 'tokens', basic: 120_000_000, premium: 40_000_000 },
} as const;

export function getUsageUnitForTier(tier: UsageTier): UsageUnit {
  return TIER_LIMITS[tier].unit;
}

function getUsageLimit(category: ModelCategory, tier: UsageTier): number {
  return TIER_LIMITS[tier][category];
}

function shouldResetUsageRow(
  quotaRow: Pick<UsageQuotaRow, 'limit_amount' | 'period_end' | 'plan_tier' | 'unit'>,
  now: Date,
  limit: number,
  tier: UsageTier,
  unit: UsageUnit,
): boolean {
  const isPeriodExpired = quotaRow.period_end && new Date(quotaRow.period_end) <= now;
  const hasLimitChanged = quotaRow.limit_amount !== limit;
  const hasTierChanged = quotaRow.plan_tier !== tier;
  const hasUnitChanged = quotaRow.unit !== unit;
  return Boolean(isPeriodExpired || hasLimitChanged || hasTierChanged || hasUnitChanged);
}

/**
 * Get the first day of next month in UTC
 */
function getNextMonthFirstDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/**
 * Determine tier from billing info
 */
function determineTier(billing: BillingRow | null, isTeam: boolean): UsageTier {
  if (!billing) return 'free';

  const { plan_id, status, current_period_end } = billing;

  // Check if billing is active
  const isActiveStatus = ACTIVE_STATUSES.includes(status);
  const isInGracePeriod = status === 'canceled' && current_period_end && new Date(current_period_end) > new Date();
  const isActive = isActiveStatus || isInGracePeriod;

  if (!isActive) return 'free';

  // Team billing is always pro
  if (isTeam) return 'pro';

  // Personal billing: check plan_id
  if (plan_id?.startsWith('pro')) return 'pro';
  if (plan_id?.startsWith('max')) return 'max';
  if (plan_id?.startsWith('plus')) return 'plus';
  return 'free';
}

/**
 * Fetch Deni AI user's plan info, usage, and remaining quota
 */
export async function getDeniUsageInfo(userId: string): Promise<DeniUsageInfo> {
  const pool = getDeniPool();

  // Query team billing first (higher priority)
  const teamBillingResult = await pool.query<BillingRow>(
    `SELECT b.plan_id, b.status, b.current_period_end, b.max_mode_enabled
     FROM billing b
     INNER JOIN member m ON b.organization_id = m.organization_id
     WHERE m.user_id = $1
       AND b.organization_id IS NOT NULL
       AND b.plan_id LIKE 'pro_team%'
     ORDER BY ${BILLING_PRIORITY_ORDER.replaceAll('status', 'b.status').replaceAll('current_period_end', 'b.current_period_end')}, b.current_period_end DESC NULLS LAST
     LIMIT 1`,
    [userId]
  );

  // Query personal billing as fallback
  const personalBillingResult = await pool.query<BillingRow>(
    `SELECT plan_id, status, current_period_end, max_mode_enabled
     FROM billing
     WHERE user_id = $1 AND organization_id IS NULL
     ORDER BY ${BILLING_PRIORITY_ORDER}, current_period_end DESC NULLS LAST
     LIMIT 1`,
    [userId]
  );

  // Determine which billing to use
  let billing: BillingRow | null = null;
  let isTeam = false;

  if (teamBillingResult.rows.length > 0) {
    const teamBilling = teamBillingResult.rows[0];
    const isActiveStatus = ACTIVE_STATUSES.includes(teamBilling.status);
    const isInGracePeriod = teamBilling.status === 'canceled' &&
      teamBilling.current_period_end &&
      new Date(teamBilling.current_period_end) > new Date();

    if (isActiveStatus || isInGracePeriod) {
      billing = teamBilling;
      isTeam = true;
    }
  }

  // Fallback to personal billing if no active team billing
  if (!billing && personalBillingResult.rows.length > 0) {
    billing = personalBillingResult.rows[0];
  }

  const tier = determineTier(billing, isTeam);

  // Determine Max Mode eligibility
  const maxModeEligible = billing?.plan_id?.startsWith('pro') === true && billing.status === 'active';
  const maxModeEnabled = maxModeEligible && (billing?.max_mode_enabled ?? false);

  // Determine period end
  let periodEnd: string | null = null;
  periodEnd = getNextMonthFirstDay().toISOString();

  // Query usage quotas
  const usageResult = await pool.query<UsageQuotaRow>(
    `SELECT category, plan_tier, limit_amount, unit, used, period_start, period_end
     FROM usage_quota
     WHERE user_id = $1`,
    [userId]
  );

  const now = new Date();
  const defaultPeriodEnd = getNextMonthFirstDay().toISOString();
  const unit = getUsageUnitForTier(tier);
  const usage: DeniUsageInfo['usage'] = [];

  // Process each category
  for (const category of ['basic', 'premium'] as const) {
    const quotaRow = usageResult.rows.find(r => r.category === category);
    const limit = getUsageLimit(category, tier);

    if (quotaRow) {
      const needsReset = shouldResetUsageRow(quotaRow, now, limit, tier, unit);
      const used = needsReset ? 0 : quotaRow.used;
      const remaining = Math.max(limit - used, 0);

      usage.push({
        category,
        unit,
        limit,
        used,
        remaining,
        periodStart: needsReset ? now.toISOString() : new Date(quotaRow.period_start).toISOString(),
        periodEnd: needsReset ? defaultPeriodEnd : quotaRow.period_end ? new Date(quotaRow.period_end).toISOString() : null,
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
): Promise<{ allowed: boolean; remaining: number; reserved: boolean; unit: UsageUnit }> {
  const pool = getDeniPool();
  const now = new Date();
  const periodEnd = getNextMonthFirstDay();
  const limit = getUsageLimit(category, tier);
  const unit = getUsageUnitForTier(tier);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query<Pick<UsageQuotaRow, 'used' | 'period_end' | 'limit_amount' | 'plan_tier' | 'unit'>>(
      `SELECT used, period_end, limit_amount, plan_tier, unit
       FROM usage_quota
       WHERE user_id = $1 AND category = $2
       FOR UPDATE`,
      [userId, category]
    );

    if (result.rows.length === 0) {
      if (unit === 'requests') {
        await client.query(
          `INSERT INTO usage_quota (user_id, category, plan_tier, limit_amount, unit, used, period_start, period_end)
           VALUES ($1, $2, $3, $4, $5, 1, $6, $7)`,
          [userId, category, tier, limit, unit, now, periodEnd]
        );
        await client.query('COMMIT');
        return { allowed: true, remaining: Math.max(limit - 1, 0), reserved: true, unit };
      }

      await client.query('COMMIT');
      return { allowed: true, remaining: limit, reserved: false, unit };
    }

    const currentRow = result.rows[0];
    const needsReset = shouldResetUsageRow(currentRow, now, limit, tier, unit);
    const currentUsed = needsReset ? 0 : currentRow.used;

    if (currentUsed >= limit) {
      await client.query('ROLLBACK');
      return { allowed: false, remaining: 0, reserved: false, unit };
    }

    if (unit !== 'requests') {
      if (needsReset) {
        await client.query(
          `UPDATE usage_quota
           SET used = 0,
               plan_tier = $3,
               limit_amount = $4,
               unit = $5,
               period_start = $6,
               period_end = $7
           WHERE user_id = $1 AND category = $2`,
          [userId, category, tier, limit, unit, now, periodEnd]
        );
      }

      await client.query('COMMIT');
      return { allowed: true, remaining: Math.max(limit - currentUsed, 0), reserved: false, unit };
    }

    await client.query(
      `UPDATE usage_quota
       SET used = $3,
           plan_tier = $4,
           limit_amount = $5,
           unit = $6,
           period_start = CASE WHEN $7 THEN $8 ELSE period_start END,
           period_end = CASE WHEN $7 THEN $9 ELSE period_end END
       WHERE user_id = $1 AND category = $2`,
      [userId, category, currentUsed + 1, tier, limit, unit, needsReset, now, periodEnd]
    );
    await client.query('COMMIT');
    return { allowed: true, remaining: Math.max(limit - (currentUsed + 1), 0), reserved: true, unit };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`[Usage] Failed to reserve usage for user=${userId} category=${category}:`, error);
    throw error;
  } finally {
    client.release();
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
): Promise<void> {
  if (getUsageUnitForTier(tier) !== 'tokens' || !Number.isFinite(amount) || amount <= 0) {
    return;
  }

  const pool = getDeniPool();
  const now = new Date();
  const periodEnd = getNextMonthFirstDay();
  const limit = getUsageLimit(category, tier);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query<Pick<UsageQuotaRow, 'used' | 'period_end' | 'limit_amount' | 'plan_tier' | 'unit'>>(
      `SELECT used, period_end, limit_amount, plan_tier, unit
       FROM usage_quota
       WHERE user_id = $1 AND category = $2
       FOR UPDATE`,
      [userId, category]
    );

    const unit = getUsageUnitForTier(tier);
    if (result.rows.length === 0) {
      await client.query(
        `INSERT INTO usage_quota (user_id, category, plan_tier, limit_amount, unit, used, period_start, period_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, category, tier, limit, unit, amount, now, periodEnd]
      );
      await client.query('COMMIT');
      return;
    }

    const currentRow = result.rows[0];
    const needsReset = shouldResetUsageRow(currentRow, now, limit, tier, unit);
    const currentUsed = needsReset ? 0 : currentRow.used;

    await client.query(
      `UPDATE usage_quota
       SET used = $3,
           plan_tier = $4,
           limit_amount = $5,
           unit = $6,
           period_start = CASE WHEN $7 THEN $8 ELSE period_start END,
           period_end = CASE WHEN $7 THEN $9 ELSE period_end END
       WHERE user_id = $1 AND category = $2`,
      [userId, category, currentUsed + amount, tier, limit, unit, needsReset, now, periodEnd]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`[Usage] Failed to record usage for user=${userId} category=${category}:`, error);
    throw error;
  } finally {
    client.release();
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
  if (getUsageUnitForTier(tier) !== 'requests') {
    return;
  }

  const pool = getDeniPool();

  try {
    await pool.query(
      `UPDATE usage_quota
       SET used = GREATEST(used - 1, 0)
       WHERE user_id = $1 AND category = $2`,
      [userId, category]
    );
  } catch (error) {
    console.error(`[Usage] Failed to release usage for user=${userId} category=${category}:`, error);
  }
}
