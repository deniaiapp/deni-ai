import { createHash } from "node:crypto";
import type { UIMessage } from "ai";
import { nextCron } from "./cron";
import { claimNextJobs, createJob, getJobByIdempotencyKey, recoverStaleJobs } from "./index";
import { translatorFor } from "../i18n/standalone";
import { runClaimedJob } from "./runner";
import {
  listDueRoutineUserIds,
  loadMessages,
  mutateStore,
  readStore,
  saveMessages,
} from "../data/store";
import { runConfig, runLogger } from "../runtime";
import type { AgentJob } from "../types";

/**
 * The Run scheduler. Each tick: recover jobs whose lease expired, enqueue due routines,
 * then claim queued jobs (`FOR UPDATE SKIP LOCKED`) up to the configured concurrency and
 * run them in this process. Several schedulers (the worker and an in-process dev
 * scheduler) can run against one database; the queue keeps each job with one of them.
 * The host decides whether to start it (`services/run-worker`, or the web app with
 * `RUN_SCHEDULER_IN_PROCESS=true`).
 */

const DEFAULT_INTERVAL_MS = 30_000;

const g = globalThis as typeof globalThis & {
  __deniRunScheduler?: { timer: ReturnType<typeof setInterval>; stopping: boolean };
  __deniRunSchedulerTick?: Promise<void>;
  __deniRunSchedulerJobs?: Map<string, Promise<void>>;
};

function activeJobs() {
  if (!g.__deniRunSchedulerJobs) g.__deniRunSchedulerJobs = new Map();
  return g.__deniRunSchedulerJobs;
}

/** Jobs this process is running now. */
export function runningJobCount() {
  return activeJobs().size;
}

/**
 * Start ticking (immediately, then every `intervalMs`). Returns a stop function that stops
 * claiming new work and waits for the jobs this process is running. Starting twice in one
 * process returns the existing scheduler's stop function.
 */
export function startScheduler(options?: { intervalMs?: number }): () => Promise<void> {
  if (!g.__deniRunScheduler) {
    const timer = setInterval(() => {
      tick().catch((error) => runLogger().error("[run scheduler]", error));
    }, options?.intervalMs ?? DEFAULT_INTERVAL_MS);
    timer.unref?.();
    g.__deniRunScheduler = { timer, stopping: false };
    tick().catch((error) => runLogger().error("[run scheduler]", error));
  }
  return stopScheduler;
}

async function stopScheduler() {
  const scheduler = g.__deniRunScheduler;
  if (scheduler) {
    scheduler.stopping = true;
    clearInterval(scheduler.timer);
  }
  await g.__deniRunSchedulerTick?.catch(() => undefined);
  await Promise.allSettled(activeJobs().values());
  delete g.__deniRunScheduler;
}

/** One scheduler pass. Concurrent calls in one process share the pass in flight. */
export async function tick() {
  const previous = g.__deniRunSchedulerTick;
  if (previous) return previous;
  const current = runTick();
  g.__deniRunSchedulerTick = current;
  try {
    await current;
  } finally {
    if (g.__deniRunSchedulerTick === current) delete g.__deniRunSchedulerTick;
  }
}

async function runTick() {
  await recoverStaleJobs().catch((error) => {
    runLogger().error("[run scheduler] stale job recovery", error);
  });
  if (g.__deniRunScheduler?.stopping) return;
  const now = new Date();
  for (const userId of await listDueRoutineUserIds(now)) {
    const store = await readStore(userId);
    const due = store.routines.filter(
      (item) =>
        item.enabled && item.nextRunAt && new Date(item.nextRunAt).getTime() <= now.getTime(),
    );
    for (const routine of due) {
      await enqueueRoutine(userId, routine.id).catch((error) =>
        runLogger().error("[run scheduler] routine", routine.id, error),
      );
    }
  }
  if (g.__deniRunScheduler?.stopping) return;

  const running = activeJobs();
  const capacity = runConfig().schedulerConcurrency - running.size;
  if (capacity <= 0) return;
  for (const job of await claimNextJobs(capacity)) startClaimed(job);
}

function startClaimed(job: AgentJob) {
  const running = activeJobs();
  const task = runClaimedJob(job)
    .catch((error) => runLogger().error("[run scheduler] job", job.id, error))
    .then(() => undefined);
  running.set(job.id, task);
  void task.finally(() => {
    if (running.get(job.id) === task) running.delete(job.id);
  });
}

/** Wait for the jobs this process started (tests and graceful shutdown). */
export async function waitForRunningJobs() {
  await Promise.allSettled(activeJobs().values());
}

/**
 * Queue a due routine run. The idempotency key includes the scheduled time and revision,
 * so a second scheduler (or a retried tick) cannot queue the same run twice.
 */
export async function enqueueRoutine(userId: string, routineId: string) {
  const store = await readStore(userId);
  const routine = store.routines.find((item) => item.id === routineId);
  if (
    !routine ||
    !routine.enabled ||
    !routine.nextRunAt ||
    new Date(routine.nextRunAt).getTime() > Date.now()
  )
    return null;
  const bot = store.bots.find((item) => item.id === routine.botId);
  if (!bot) return null;
  const scheduledFor = routine.nextRunAt;
  const routineRevision = routine.revision ?? 0;
  const idempotencyKey = `routine:${routine.id}:${scheduledFor}:v${routineRevision}`;
  const existing = await getJobByIdempotencyKey(userId, idempotencyKey);
  if (existing) return existing;
  const tr = translatorFor(routine.locale);
  const kickoff: UIMessage = {
    id: `routine_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24)}`,
    role: "user",
    parts: [
      {
        type: "text",
        text: `${tr("[Routine {name}]", { name: routine.name })}\n${routine.instructions}\n\n${tr("This is a scheduled run. Do not perform actions that require approval; leave the result behind.")}`,
      },
    ],
  };
  const previous = await loadMessages(userId, routine.threadId);
  const messages = [...previous, kickoff];
  await saveMessages(userId, routine.threadId, [kickoff]);
  const job = await createJob({
    userId,
    threadId: routine.threadId,
    botId: bot.id,
    kind: "routine",
    idempotencyKey,
    payload: {
      messages,
      routineId: routine.id,
      routineRevision,
      runMode: store.config.runMode,
      locale: routine.locale,
    },
    maxAttempts: 2,
  });
  // Advance the schedule at enqueue time so a long run cannot be queued again.
  await mutateStore(userId, (next) => {
    const item = next.routines.find((entry) => entry.id === routine.id);
    if (
      !item ||
      !item.enabled ||
      item.nextRunAt !== scheduledFor ||
      (item.revision ?? 0) !== routineRevision
    )
      return;
    item.nextRunAt = nextCron(
      item.cron,
      item.timezone || next.config.timezone,
      new Date(scheduledFor),
    );
  });
  return job;
}
