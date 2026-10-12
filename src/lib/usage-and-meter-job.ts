import { count, eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { maxModeMeterEvent } from "@/db/schema";
import { retryMaxModeUsageReports } from "@/lib/max-mode";
import { recoverUsageReservations } from "@/lib/usage";

/**
 * One usage-recovery and Max Mode meter run: run every minute in-process by a
 * production server (`background-job-scheduler.ts`), or triggered through
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
