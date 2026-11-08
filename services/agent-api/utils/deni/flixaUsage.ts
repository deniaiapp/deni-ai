import { randomUUID } from 'node:crypto';
import { SHARED_USAGE_CATEGORY, UsageLimitError } from '@deniai/billing/server';
import { billing } from '@deniai/db';
import type { DeniUsageInfo } from '@deniai/flixa-contract';
import { eq } from 'drizzle-orm';
import { getDeniDb } from './db';
import type { ModelCategory } from './models';
import {
  getDeniUsageInfo,
  getUpgradeUrl,
  getVerifyUrl,
  reserveUsageQuota,
  settleUsageQuota,
  USAGE_UNIT,
  type UsageReservation,
  type UsageTier,
  type UsageUnit,
} from './usage';
import { getFlixaUsageEngine, getFlixaUsageEngineMode } from './usageEngine';

/** A held Flixa reservation and the implementation that must settle it. */
export interface FlixaUsageReservation extends UsageReservation {
  /** `shared`: `public.usage_reservation`; `legacy`: `flixa.usage_reservation` (deprecated). */
  engine: 'shared' | 'legacy';
}

export interface FlixaReserveResult {
  allowed: boolean;
  reserved: boolean;
  /** Units the pool has left after this request (0 when refused). */
  remaining: number;
  unit: UsageUnit;
  reservation?: FlixaUsageReservation;
}

export interface FlixaReserveInput {
  userId: string;
  /** The model's category, as the legacy path records it (always `basic` today). */
  category: ModelCategory;
  /** Plan tier from the cached billing profile (legacy path only). */
  tier: UsageTier;
  hasVerifiedPaymentMethod: boolean;
  /** Estimated usage units to hold (`UsageEstimate.reservationAmount`). */
  amount: number;
}

type SharedDecision =
  | { allowed: true; remaining: number; usedMaxMode: boolean }
  | { allowed: false; maxModeAvailable: boolean };

async function reserveShared(input: FlixaReserveInput): Promise<FlixaReserveResult> {
  const reservationId = `flixa:${randomUUID()}`;
  try {
    const result = await getFlixaUsageEngine().consumeUsage({
      userId: input.userId,
      category: SHARED_USAGE_CATEGORY,
      reservationId,
      amount: input.amount,
      product: 'flixa',
    });
    return {
      allowed: true,
      reserved: true,
      remaining: result.remaining ?? 0,
      unit: USAGE_UNIT,
      reservation: {
        id: reservationId,
        amount: input.amount,
        userId: input.userId,
        category: SHARED_USAGE_CATEGORY,
        engine: 'shared',
      },
    };
  } catch (error) {
    if (error instanceof UsageLimitError) {
      return { allowed: false, reserved: false, remaining: 0, unit: USAGE_UNIT };
    }
    throw error;
  }
}

async function reserveLegacy(input: FlixaReserveInput): Promise<FlixaReserveResult> {
  const result = await reserveUsageQuota(
    input.userId,
    input.category,
    input.tier,
    input.hasVerifiedPaymentMethod,
    input.amount,
  );
  return {
    allowed: result.allowed,
    reserved: result.reserved,
    remaining: result.remaining,
    unit: result.unit,
    reservation: result.reservation && { ...result.reservation, engine: 'legacy' },
  };
}

/**
 * What the shared engine would decide, from a reservation that is always rolled
 * back. Never throws: an engine failure is reported, not enforced.
 */
async function previewShared(
  input: FlixaReserveInput,
): Promise<SharedDecision | { error: string }> {
  try {
    const result = await getFlixaUsageEngine().consumeUsage({
      userId: input.userId,
      category: SHARED_USAGE_CATEGORY,
      reservationId: `flixa-shadow:${randomUUID()}`,
      amount: input.amount,
      product: 'flixa',
      dryRun: true,
    });
    return { allowed: true, remaining: result.remaining ?? 0, usedMaxMode: result.usedMaxMode };
  } catch (error) {
    if (error instanceof UsageLimitError) {
      return { allowed: false, maxModeAvailable: error.maxModeAvailable };
    }
    return { error: describeError(error) };
  }
}

/** The database's own message when Drizzle wrapped it ("Failed query: …" carries params). */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? error.cause.message : error.message;
}

/** One structured line per shadow difference (or shadow failure). */
function logShadow(event: string, payload: Record<string, unknown>): void {
  console.warn(JSON.stringify({ level: 'warn', event, ...payload }));
}

async function reserveShadow(input: FlixaReserveInput): Promise<FlixaReserveResult> {
  // The dry run reads the state legacy is about to change, so it goes first.
  const shared = await previewShared(input);
  const legacy = await reserveLegacy(input);
  const legacyView = {
    allowed: legacy.allowed,
    reservedAmount: legacy.reserved ? input.amount : 0,
    remaining: legacy.allowed ? legacy.remaining : null,
  };
  if ('error' in shared) {
    logShadow('flixa_usage_shadow_error', {
      userId: input.userId,
      amount: input.amount,
      legacy: legacyView,
      error: shared.error,
    });
    return legacy;
  }
  const sharedView = {
    allowed: shared.allowed,
    reservedAmount: shared.allowed ? input.amount : 0,
    remaining: shared.allowed ? shared.remaining : null,
    ...(shared.allowed
      ? { usedMaxMode: shared.usedMaxMode }
      : { maxModeAvailable: shared.maxModeAvailable }),
  };
  const differences: string[] = [];
  if (legacyView.allowed !== sharedView.allowed) differences.push('allowed');
  if (legacyView.reservedAmount !== sharedView.reservedAmount) differences.push('reservedAmount');
  if (legacyView.allowed && sharedView.allowed && legacyView.remaining !== sharedView.remaining) {
    differences.push('remaining');
  }
  if (differences.length) {
    logShadow('flixa_usage_shadow_mismatch', {
      userId: input.userId,
      amount: input.amount,
      tier: input.tier,
      differences,
      legacy: legacyView,
      shared: sharedView,
    });
  }
  return legacy;
}

/** Hold the request's estimate before the upstream call, through the configured engine. */
export async function reserveFlixaUsage(input: FlixaReserveInput): Promise<FlixaReserveResult> {
  const mode = getFlixaUsageEngineMode();
  if (mode === 'legacy') return reserveLegacy(input);
  if (mode === 'shadow') return reserveShadow(input);
  return reserveShared(input);
}

/**
 * Settle a reservation with the implementation that created it: once, with the
 * metered amount (0 refunds the whole hold).
 */
export async function settleFlixaUsage(
  reservation: FlixaUsageReservation,
  amount: number,
): Promise<void> {
  if (reservation.engine === 'shared') {
    await getFlixaUsageEngine().settleUsage({
      userId: reservation.userId,
      reservationId: reservation.id,
      amount,
    });
    return;
  }
  await settleUsageQuota(reservation, amount);
}

/** Refresh a running shared reservation's recovery lease with the usage observed so far. */
export async function recordFlixaObservedUsage(
  reservation: FlixaUsageReservation,
  amount: number,
): Promise<void> {
  if (reservation.engine !== 'shared') return;
  await getFlixaUsageEngine().recordObservedUsage({
    userId: reservation.userId,
    reservationId: reservation.id,
    amount,
  });
}

/**
 * `GET /v1/deni/usage` from the shared engine's summary (the numbers the web app
 * shows), in the unchanged `@deniai/flixa-contract` shape.
 */
export async function getSharedDeniUsageInfo(
  userId: string,
  now = new Date(),
): Promise<DeniUsageInfo> {
  const { summary, billingId, organizationId } =
    await getFlixaUsageEngine().getUsageSummaryDetails({ userId, now });
  const [billingRow] = billingId
    ? await getDeniDb()
        .select({ cardVerifiedAt: billing.cardVerifiedAt })
        .from(billing)
        .where(eq(billing.id, billingId))
        .limit(1)
    : [];
  const pool = summary.pool!;
  const used = pool.used.chat + pool.used.flixa + pool.used.run;
  const remaining = Math.max(pool.limit - used, 0);
  const periodEnd = pool.periodEnd.toISOString();
  const periodStart = (summary.usage[0]?.periodStart ?? now).toISOString();
  return {
    tier: summary.tier,
    hasVerifiedPaymentMethod: summary.hasVerifiedPaymentMethod,
    cardVerifiedAt: billingRow?.cardVerifiedAt ? billingRow.cardVerifiedAt.toISOString() : null,
    verifyUrl: getVerifyUrl(),
    upgradeUrl: getUpgradeUrl(),
    isTeam: organizationId !== null,
    planId: summary.planId,
    status: summary.status,
    // The pool's reset, as before (not the subscription's renewal date).
    periodEnd,
    maxModeEnabled: summary.maxModeEnabled,
    maxModeEligible: summary.maxModeEligible,
    // Both legacy entries report the one pool, so older clients keep working.
    usage: (['basic', 'premium'] as const).map((category) => ({
      category,
      unit: USAGE_UNIT,
      limit: pool.limit,
      used,
      remaining,
      periodStart,
      periodEnd,
    })),
    pool: { limit: pool.limit, used, remaining, periodEnd },
  };
}

/** `GET /v1/deni/usage` through the configured engine (`shadow` reports legacy). */
export async function getFlixaUsageInfo(userId: string): Promise<DeniUsageInfo> {
  return getFlixaUsageEngineMode() === 'shared'
    ? getSharedDeniUsageInfo(userId)
    : getDeniUsageInfo(userId);
}
