import { isNull, min } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { usageReservation } from "@/db/schema";
import { recoverUsageReservations, USAGE_RESERVATION_STALE_MS } from "@/lib/usage";

/**
 * One usage-recovery run: run in-process by a production server when work is due
 * (`background-job-scheduler.ts`), or triggered through `/api/cron/usage-and-meter`.
 * Settles up to five usage reservations silent for 15 minutes; `healthy` is false
 * while recoveries fail.
 *
 * Safe on several replicas at once: settlement re-reads the reservation under
 * the per-user lock and returns early once it is settled.
 */
export async function runUsageAndMeterJob() {
  const recovery = await recoverUsageReservations();
  return { ...recovery, healthy: recovery.recoveryFailed === 0 };
}

/**
 * When the job next has work: the oldest unsettled reservation turning stale
 * (`null` when there is none). A time already passed means work is due now,
 * e.g. a batch that did not finish everything.
 */
export async function getUsageAndMeterNextDueAt(): Promise<Date | null> {
  const [reservation] = await db
    .select({ updatedAt: min(usageReservation.updatedAt) })
    .from(usageReservation)
    .where(isNull(usageReservation.settledAt));
  return reservation?.updatedAt
    ? new Date(reservation.updatedAt.getTime() + USAGE_RESERVATION_STALE_MS)
    : null;
}
