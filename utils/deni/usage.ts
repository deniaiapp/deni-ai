import { getDeniPool } from './db';
import type { DeniUsageInfo, BillingRow, UsageQuotaRow } from './types';
import type { ModelCategory } from './models';

export type UsageTier = 'free' | 'plus' | 'pro' | 'max';

// Active billing statuses
const ACTIVE_STATUSES = ['active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paid'];

// Tier-based usage limits
const TIER_LIMITS = {
  basic: { free: 500, plus: 1500, pro: 3000, max: 10000 },
  premium: { free: 50, plus: 400, pro: 800, max: 2000 },
} as const;

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
  if (plan_id.startsWith('pro')) return 'pro';
  if (plan_id.startsWith('max')) return 'max';
  return 'plus';
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
     LIMIT 1`,
    [userId]
  );

  // Query personal billing as fallback
  const personalBillingResult = await pool.query<BillingRow>(
    `SELECT plan_id, status, current_period_end, max_mode_enabled
     FROM billing
     WHERE user_id = $1 AND organization_id IS NULL
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
  const maxModeEligible = billing ? billing.plan_id.startsWith('pro') && billing.status === 'active' : false;
  const maxModeEnabled = maxModeEligible && (billing?.max_mode_enabled ?? false);

  // Determine period end
  let periodEnd: string | null = null;
  periodEnd = getNextMonthFirstDay().toISOString();

  // Query usage quotas
  const usageResult = await pool.query<UsageQuotaRow>(
    `SELECT category, limit_amount, used, period_start, period_end
     FROM usage_quota
     WHERE user_id = $1`,
    [userId]
  );

  const now = new Date();
  const usage: DeniUsageInfo['usage'] = [];

  // Process each category
  for (const category of ['basic', 'premium'] as const) {
    const quotaRow = usageResult.rows.find(r => r.category === category);

    if (quotaRow) {
      // Check if period has expired (reset used to 0)
      const isPeriodExpired = quotaRow.period_end && new Date(quotaRow.period_end) < now;
      const used = isPeriodExpired ? 0 : quotaRow.used;
      const limit = TIER_LIMITS[category][tier];
      const remaining = Math.max(limit - used, 0);

      usage.push({
        category,
        limit,
        used,
        remaining,
        periodStart: new Date(quotaRow.period_start).toISOString(),
        periodEnd: quotaRow.period_end ? new Date(quotaRow.period_end).toISOString() : null,
      });
    } else {
      // No quota record exists, assume fresh start
      const limit = TIER_LIMITS[category][tier];
      usage.push({
        category,
        limit,
        used: 0,
        remaining: limit,
        periodStart: now.toISOString(),
        periodEnd: getNextMonthFirstDay().toISOString(),
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
): Promise<{ allowed: boolean; remaining: number }> {
  const pool = getDeniPool();
  const now = new Date();
  const periodEnd = getNextMonthFirstDay();
  const limit = TIER_LIMITS[category][tier];
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query<Pick<UsageQuotaRow, 'used' | 'period_end'>>(
      `SELECT used, period_end
       FROM usage_quota
       WHERE user_id = $1 AND category = $2
       FOR UPDATE`,
      [userId, category]
    );

    if (result.rows.length === 0) {
      await client.query(
        `INSERT INTO usage_quota (user_id, category, used, period_start, period_end)
         VALUES ($1, $2, 1, $3, $4)`,
        [userId, category, now, periodEnd]
      );
      await client.query('COMMIT');
      return { allowed: true, remaining: Math.max(limit - 1, 0) };
    }

    const currentRow = result.rows[0];
    const isPeriodExpired = currentRow.period_end && new Date(currentRow.period_end) < now;
    const currentUsed = isPeriodExpired ? 0 : currentRow.used;

    if (currentUsed >= limit) {
      await client.query('ROLLBACK');
      return { allowed: false, remaining: 0 };
    }

    await client.query(
      `UPDATE usage_quota
       SET used = $3,
       period_start = CASE
         WHEN period_end IS NOT NULL AND period_end < $4 THEN $4
         ELSE period_start
       END,
       period_end = CASE
         WHEN period_end IS NOT NULL AND period_end < $4 THEN $5
         ELSE period_end
       END
       WHERE user_id = $1 AND category = $2`,
      [userId, category, currentUsed + 1, now, periodEnd]
    );
    await client.query('COMMIT');
    return { allowed: true, remaining: Math.max(limit - (currentUsed + 1), 0) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`[Usage] Failed to reserve usage for user=${userId} category=${category}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Release one reserved usage unit after an upstream request fails before producing
 * a successful response for the client.
 */
export async function releaseUsageQuota(userId: string, category: ModelCategory): Promise<void> {
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
