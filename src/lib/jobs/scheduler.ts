import "@tanstack/react-start/server-only";

import { type UIMessage } from "ai";
import { nextCron } from "../agent";
import { createHash } from "node:crypto";
import {
  createJob,
  getJobByIdempotencyKey,
  listQueuedJobs,
  recoverStaleJobs,
} from "./index";
import { translatorFor } from "@/i18n/standalone";
import { runBackgroundJob } from "./runner";
import {
  listDueRoutineUserIds,
  listUserStores,
  loadMessages,
  mutateStore,
  readStore,
  saveMessages,
} from "../data/store";

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;
const configuredConcurrency = Number.parseInt(process.env.DENI_SCHEDULER_CONCURRENCY ?? "", 10);
const SCHEDULER_CONCURRENCY = Number.isFinite(configuredConcurrency)
  ? Math.min(Math.max(configuredConcurrency, 1), MAX_CONCURRENCY)
  : DEFAULT_CONCURRENCY;

const g = globalThis as typeof globalThis & {
  __deniScheduler?: boolean;
  __deniSchedulerTick?: Promise<void>;
  __deniSchedulerJobs?: Map<string, Promise<void>>;
};

function activeJobs() {
  if (!g.__deniSchedulerJobs) g.__deniSchedulerJobs = new Map();
  return g.__deniSchedulerJobs;
}

export function startScheduler() {
  if (g.__deniScheduler || process.env.DENI_SCHEDULER !== "true") return;
  g.__deniScheduler = true;
  setInterval(() => {
    tick().catch((error) => {
      console.error("[deni scheduler]", error);
      void import("../report").then(({ reportError }) => reportError(error, "scheduler"));
    });
  }, 30_000);
  tick().catch(() => undefined);
}

/** Run stale recovery before claiming work so a process restart cannot strand a task. */
export async function tick() {
  const previous = g.__deniSchedulerTick;
  if (previous) return previous;
  const current = runTick();
  g.__deniSchedulerTick = current;
  try {
    await current;
  } finally {
    if (g.__deniSchedulerTick === current) delete g.__deniSchedulerTick;
  }
}

async function runTick() {
  await recoverStaleJobs().catch((error) => {
    console.error("[deni scheduler] stale job recovery", error);
  });
  let userIds: string[];
  try {
    userIds = await listDueRoutineUserIds(new Date());
  } catch {
    userIds = (await listUserStores()).map((row) => row.userId);
  }
  for (const userId of userIds) {
    const store = await readStore(userId);
    const now = Date.now();
    const due = (store.routines ?? []).filter(
      (item) => item.enabled && item.nextRunAt && new Date(item.nextRunAt).getTime() <= now,
    );
    for (const routine of due) await enqueueRoutine(userId, routine.id);
  }

  const running = activeJobs();
  const capacity = SCHEDULER_CONCURRENCY - running.size;
  if (capacity <= 0) return;
  // Jobs are claimed one at a time in runBackgroundJob; another scheduler process can
  // safely observe the same queue because the claim is protected by a row lock. The
  // in-process limit keeps one worker from starting the entire queue at once.
  for (const job of await listQueuedJobs(capacity)) {
    if (running.has(job.id)) continue;
    const task = runBackgroundJob(job.userId ?? "", job.id)
      .catch((error) => {
        console.error("[deni scheduler] job", job.id, error);
      })
      .then(() => undefined);
    running.set(job.id, task);
    void task.finally(() => {
      if (running.get(job.id) === task) running.delete(job.id);
    });
  }
}

async function enqueueRoutine(userId: string, routineId: string) {
  const store = await readStore(userId);
  const routine = store.routines.find((item) => item.id === routineId);
  if (!routine || !routine.enabled || !routine.nextRunAt || new Date(routine.nextRunAt).getTime() > Date.now()) return null;
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
    payload: { messages, routineId: routine.id, routineRevision, runMode: store.config.runMode, locale: routine.locale },
    maxAttempts: 2,
  });
  // Advance the schedule at enqueue time. This prevents duplicate kickoff messages while
  // a long task is running; the run history is finalized by the worker.
  await mutateStore(userId, (next) => {
    const item = next.routines.find((entry) => entry.id === routine.id);
    if (!item || !item.enabled || item.nextRunAt !== scheduledFor || (item.revision ?? 0) !== routineRevision) return;
    item.nextRunAt = nextCron(item.cron, item.timezone || next.config.timezone, new Date(scheduledFor));
  });
  return job;
}
