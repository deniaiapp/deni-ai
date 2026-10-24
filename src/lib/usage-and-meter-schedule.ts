/**
 * When the in-process usage and meter job next needs the database. Its ticks
 * stay every minute, but a tick before this time skips without a query, so an
 * idle server lets a scale-to-zero database (Neon) suspend.
 *
 * Kept free of database imports so `usage.ts` can move the time earlier
 * without an import cycle through the job.
 */

/** Longest wait between checks: catches work another replica left behind. */
export const USAGE_AND_METER_IDLE_CHECK_MS = 60 * 60_000;

const globalForSchedule = globalThis as typeof globalThis & {
  usageAndMeterNextCheckAt?: number;
};

export function isUsageAndMeterCheckDue(now = Date.now()) {
  return now >= (globalForSchedule.usageAndMeterNextCheckAt ?? 0);
}

/** Moves the next check to `at` when that is earlier; a later time changes nothing. */
export function requestUsageAndMeterCheck(at: number) {
  const current = globalForSchedule.usageAndMeterNextCheckAt;
  if (current === undefined || at < current) globalForSchedule.usageAndMeterNextCheckAt = at;
}

/**
 * Starts a check: the next one defaults to the idle wait. Requests made while
 * the run is in progress (and the run's own due time) can still move it earlier.
 */
export function beginUsageAndMeterCheck(now = Date.now()) {
  globalForSchedule.usageAndMeterNextCheckAt = now + USAGE_AND_METER_IDLE_CHECK_MS;
}
