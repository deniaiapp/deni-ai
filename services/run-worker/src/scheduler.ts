import { startScheduler } from "@deniai/run/jobs/scheduler";

/**
 * Start `@deniai/run`'s scheduler (stale-lease recovery, due routines, claiming with
 * `FOR UPDATE SKIP LOCKED` up to `RUN_SCHEDULER_CONCURRENCY`) and return its stop
 * function, which stops claiming and resolves once running jobs have finished.
 */
export function startRunScheduler(options?: { intervalMs?: number }): () => Promise<void> {
  return startScheduler(options);
}
