import * as Sentry from "@sentry/tanstackstart-react";
import { runGuestCleanupJob } from "@/lib/guest-cleanup-job";
import { runStorageCleanupJob } from "@/lib/storage-cleanup-job";
import { getUsageAndMeterNextDueAt, runUsageAndMeterJob } from "@/lib/usage-and-meter-job";
import {
  beginUsageAndMeterCheck,
  isUsageAndMeterCheckDue,
  requestUsageAndMeterCheck,
} from "@/lib/usage-and-meter-schedule";

/** Failure counts of a run, each above 0 when that part failed. */
export type JobFailureCounts = Record<string, number>;

export type BackgroundJob = {
  /** Unique name, used in logs, as the Sentry `job` tag, and to schedule it once. */
  name: string;
  /** Delay between boot and the first run. */
  firstDelayMs: number;
  /** Delay between later runs. A run still in progress makes the next one skip. */
  intervalMs: number;
  /** One run: its failure counts when it found failures, `null` when healthy. May throw. */
  run: () => Promise<JobFailureCounts | null>;
};

/** A job that keeps failing is reported at most this often, unless one of its counts grows. */
export const FAILURE_REPORT_INTERVAL_MS = 60 * 60_000;

/**
 * How long a run may stay in progress before the ticks it makes skip report it
 * as stuck: three intervals, and at least 15 minutes.
 */
export function stuckRunThresholdMs(intervalMs: number) {
  return Math.max(3 * intervalMs, 15 * 60_000);
}

const globalForJobs = globalThis as typeof globalThis & {
  scheduledBackgroundJobs?: Set<string>;
};

/**
 * Reports failure counts with `console.error` and a Sentry warning (the alert
 * that replaces an external scheduler's 503): the first time, then only when
 * an hour has passed since the last report or a count exceeds the reported one.
 * Healthy runs in between do not reset it, so a job flapping every minute
 * between failing and healthy is not reported every other minute either.
 */
function createFailureReporter(name: string) {
  let last: { at: number; counts: JobFailureCounts } | undefined;
  return (counts: JobFailureCounts) => {
    const now = Date.now();
    if (
      last &&
      now - last.at < FAILURE_REPORT_INTERVAL_MS &&
      Object.entries(counts).every(([key, value]) => value <= (last?.counts[key] ?? 0))
    )
      return;
    last = { at: now, counts };
    console.error(`[background-jobs] ${name} reported failures`, counts);
    Sentry.captureMessage(`Background job ${name} reported failures`, {
      level: "warning",
      tags: { job: name },
      extra: counts,
    });
  };
}

/**
 * Reports a run that is still in progress after `stuckRunThresholdMs` (a hung
 * query or storage call, which leaves every later tick skipping), with
 * `console.error` and a Sentry warning: once it crosses the threshold, then at
 * most once an hour while a run of the job stays stuck.
 */
function createStuckRunReporter(name: string, intervalMs: number) {
  const thresholdMs = stuckRunThresholdMs(intervalMs);
  let lastReportAt: number | undefined;
  return (startedAt: number) => {
    const now = Date.now();
    const runningForMs = now - startedAt;
    if (runningForMs < thresholdMs) return;
    if (lastReportAt !== undefined && now - lastReportAt < FAILURE_REPORT_INTERVAL_MS) return;
    lastReportAt = now;
    console.error(`[background-jobs] ${name} is stuck`, { runningForMs });
    Sentry.captureMessage(`Background job ${name} is stuck`, {
      level: "warning",
      tags: { job: name },
      extra: { runningForMs },
    });
  };
}

/**
 * Runs `job` in-process, first after `firstDelayMs`, then every `intervalMs`.
 * Once per process (HMR or a second `register()` cannot schedule it twice),
 * never two runs at once (a run that stays in progress too long is reported),
 * timers that do not keep the process alive, and errors caught and sent to
 * Sentry.
 */
export function scheduleBackgroundJob(job: BackgroundJob) {
  const scheduled = (globalForJobs.scheduledBackgroundJobs ??= new Set());
  if (scheduled.has(job.name)) return;
  scheduled.add(job.name);

  const reportFailures = createFailureReporter(job.name);
  const reportStuckRun = createStuckRunReporter(job.name, job.intervalMs);
  let running = false;
  let startedAt = 0;
  const tick = async () => {
    if (running) {
      reportStuckRun(startedAt);
      return;
    }
    running = true;
    startedAt = Date.now();
    try {
      const failures = await job.run();
      if (failures) reportFailures(failures);
    } catch (error) {
      console.error(`[background-jobs] ${job.name} failed`, error);
      Sentry.captureException(error, { tags: { job: job.name } });
    } finally {
      running = false;
    }
  };

  setTimeout(() => {
    void tick();
    setInterval(tick, job.intervalMs).unref();
  }, job.firstDelayMs).unref();
}

/**
 * Usage reservation recovery (first 30 seconds after boot). It ticks every minute
 * but queries the database only when work is due (`usage-and-meter-schedule.ts`):
 * when a reservation turns stale, as read after each run or requested by
 * `usage.ts` when a settlement fails, and otherwise once an hour, so an idle
 * server lets the database suspend. Its failure count is this run's failed
 * recoveries. (The job and schedule names predate prepaid Max Mode credits.)
 */
export const usageAndMeterJob: BackgroundJob = {
  name: "usage-and-meter",
  firstDelayMs: 30_000,
  intervalMs: 60_000,
  run: async () => {
    if (!isUsageAndMeterCheckDue()) return null;
    beginUsageAndMeterCheck();
    let result: Awaited<ReturnType<typeof runUsageAndMeterJob>>;
    try {
      result = await runUsageAndMeterJob();
      const nextDueAt = await getUsageAndMeterNextDueAt();
      if (nextDueAt) requestUsageAndMeterCheck(nextDueAt.getTime());
    } catch (error) {
      // Work may remain that could not be read: try again on the next tick.
      requestUsageAndMeterCheck(0);
      throw error;
    }
    if (result.healthy) return null;
    return { recoveryFailed: result.recoveryFailed };
  },
};

/** Attachment and data export storage cleanup every hour (first 2 minutes after boot). */
export const storageCleanupJob: BackgroundJob = {
  name: "storage-cleanup",
  firstDelayMs: 2 * 60_000,
  intervalMs: 60 * 60_000,
  run: async () => {
    const result = await runStorageCleanupJob();
    if (result.healthy) return null;
    return { attachmentsFailed: result.failed, exportsFailed: result.exports.failed };
  },
};

/** Deletion of guest accounts no session can sign in to, every hour (first 5 minutes after boot). */
export const guestCleanupJob: BackgroundJob = {
  name: "guest-cleanup",
  firstDelayMs: 5 * 60_000,
  intervalMs: 60 * 60_000,
  run: async () => {
    const result = await runGuestCleanupJob();
    if (result.healthy) return null;
    return { guestsFailed: result.failed };
  },
};

/**
 * Runs the periodic maintenance jobs in-process on a long-running production
 * server (Docker / Dokploy), so they need no external scheduler or
 * `CRON_SECRET`. Every replica runs them; each job is safe to run concurrently
 * (see `runUsageAndMeterJob` and `runStorageCleanupJob`). Their HTTP routes
 * under `/api/cron/` remain for manual or external triggering, and replace
 * this scheduler on Vercel, where `register()` does not start it.
 */
export function startBackgroundJobScheduler() {
  scheduleBackgroundJob(usageAndMeterJob);
  scheduleBackgroundJob(storageCleanupJob);
  scheduleBackgroundJob(guestCleanupJob);
}
