import {
  createUsageEngine,
  USAGE_RESERVATION_STALE_MS,
  type UsageEngine,
} from '@deniai/billing/server';
import { getDeniDb, type DeniDb } from './db';

/**
 * Which implementation reserves and settles Flixa usage (`FLIXA_USAGE_ENGINE`):
 *
 * - `shared` (default): the usage engine shared with Deni AI chat
 *   (`@deniai/billing/server`): team usage policy, Max Mode credits, reservation
 *   recovery and the product ledger apply to Flixa.
 * - `legacy`: the previous raw-SQL path (`usage.ts`), kept for rollback.
 * - `shadow`: legacy stays authoritative and writes; the shared engine runs the
 *   same reservation as a rolled-back dry run and differences are logged.
 *
 * See packages/billing/docs/usage-engine.md.
 */
export type FlixaUsageEngineMode = 'shared' | 'legacy' | 'shadow';

const MODES: readonly FlixaUsageEngineMode[] = ['shared', 'legacy', 'shadow'];
let warnedInvalidMode: string | null = null;

/** Read per call, so a restart is the only way the mode changes in production. */
export function getFlixaUsageEngineMode(): FlixaUsageEngineMode {
  const raw = process.env.FLIXA_USAGE_ENGINE?.trim().toLowerCase();
  if (!raw) return 'shared';
  if ((MODES as readonly string[]).includes(raw)) return raw as FlixaUsageEngineMode;
  if (warnedInvalidMode !== raw) {
    warnedInvalidMode = raw;
    console.warn(
      `[Usage] Unknown FLIXA_USAGE_ENGINE=${JSON.stringify(raw)}; using "shared" (expected shared, legacy or shadow).`,
    );
  }
  return 'shared';
}

const engines = new WeakMap<DeniDb, UsageEngine>();

/**
 * The shared usage engine over this service's Drizzle database (the same pool as
 * the raw `pg` queries). The agent API has no Stripe client, so it passes no auto
 * top-up hook; failed settlements schedule an in-process recovery run.
 */
export function getFlixaUsageEngine(): UsageEngine {
  const db = getDeniDb();
  let engine = engines.get(db);
  if (!engine) {
    engine = createUsageEngine({
      db,
      billingDisabled: false,
      logger: console,
      scheduleRecovery: scheduleUsageRecovery,
    });
    engines.set(db, engine);
  }
  return engine;
}

let recoveryTimer: { at: number; timer: ReturnType<typeof setTimeout> } | null = null;

/**
 * Settle stale reservations (`recoverUsageReservations`): up to five per run at
 * their last observed amount. The web app's usage and meter job recovers the same
 * table, so running both is safe (settlement is idempotent under the user lock).
 */
export async function runFlixaUsageRecovery(
  now = new Date(),
): Promise<{ recovered: number; recoveryFailed: number }> {
  const result = await getFlixaUsageEngine().recoverUsageReservations(now);
  if (result.recovered || result.recoveryFailed) {
    console.log(
      `[Usage] Recovery recovered=${result.recovered} failed=${result.recoveryFailed}`,
    );
  }
  return result;
}

/** Run recovery no later than `at` (epoch ms); an earlier pending run wins. */
export function scheduleUsageRecovery(at: number): void {
  if (recoveryTimer && recoveryTimer.at <= at) return;
  if (recoveryTimer) clearTimeout(recoveryTimer.timer);
  const timer = setTimeout(() => {
    recoveryTimer = null;
    runFlixaUsageRecovery().then(
      (result) => {
        // A full batch or a failure: look again once the rest can be stale.
        if (result.recoveryFailed > 0 || result.recovered >= 5) {
          scheduleUsageRecovery(Date.now() + USAGE_RESERVATION_STALE_MS);
        }
      },
      (error: unknown) => {
        console.error('[Usage] Recovery run failed:', error);
        scheduleUsageRecovery(Date.now() + USAGE_RESERVATION_STALE_MS);
      },
    );
  }, Math.max(0, at - Date.now()));
  timer.unref?.();
  recoveryTimer = { at, timer };
}

/** For tests: drop a pending recovery run. */
export function cancelScheduledUsageRecovery(): void {
  if (recoveryTimer) clearTimeout(recoveryTimer.timer);
  recoveryTimer = null;
}
