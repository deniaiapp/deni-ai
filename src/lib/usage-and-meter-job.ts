import { and, count, eq, isNull, min } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { maxModeMeterEvent, usageReservation } from "@/db/schema";
import { retryMaxModeUsageReports } from "@/lib/max-mode";
import { recoverUsageReservations, USAGE_RESERVATION_STALE_MS } from "@/lib/usage";

/**
 * One usage-recovery and Max Mode meter run: run in-process by a production
 * server when work is due (`background-job-scheduler.ts`), or triggered through
 * `/api/cron/max-mode-meter-events`. Settles up to five usage reservations
 * silent for 15 minutes, delivers up to five due meter events, and counts the
 * meter events awaiting manual review (`requiresReview`, a total, not this
 * run's). `healthy` is false while recoveries or deliveries fail or review
 * items exist.
 *
 * Safe on several replicas at once: settlement re-reads the reservation under
 * the per-user lock and returns early once it is settled (its meter event is
 * inserted with ON CONFLICT DO NOTHING), and meter delivery claims events with
 * FOR UPDATE SKIP LOCKED and a lease, sending each with its id as the Stripe
 * identifier and idempotency key.
 */
export async function runUsageAndMeterJob() {
  const recovery = await recoverUsageReservations();
  const meter = await retryMaxModeUsageReports();
  const [review] = await db
    .select({ total: count() })
    .from(maxModeMeterEvent)
    .where(eq(maxModeMeterEvent.requiresReview, true));
  const requiresReview = review?.total ?? 0;
  return {
    ...meter,
    ...recovery,
    requiresReview,
    healthy: meter.failed === 0 && recovery.recoveryFailed === 0 && requiresReview === 0,
  };
}

/**
 * When the job next has work: the oldest unsettled reservation turning stale,
 * or the earliest meter retry (`null` when neither exists). A time already
 * passed means work is due now, e.g. a batch that did not finish everything.
 */
export async function getUsageAndMeterNextDueAt(): Promise<Date | null> {
  const [[reservation], [meter]] = await Promise.all([
    db
      .select({ updatedAt: min(usageReservation.updatedAt) })
      .from(usageReservation)
      .where(isNull(usageReservation.settledAt)),
    db
      .select({ nextAttemptAt: min(maxModeMeterEvent.nextAttemptAt) })
      .from(maxModeMeterEvent)
      .where(
        and(isNull(maxModeMeterEvent.deliveredAt), eq(maxModeMeterEvent.requiresReview, false)),
      ),
  ]);
  const dueTimes = [
    reservation?.updatedAt
      ? reservation.updatedAt.getTime() + USAGE_RESERVATION_STALE_MS
      : undefined,
    meter?.nextAttemptAt?.getTime(),
  ].filter((time) => time !== undefined);
  return dueTimes.length > 0 ? new Date(Math.min(...dueTimes)) : null;
}
