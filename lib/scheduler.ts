import "server-only";

import { type UIMessage } from "ai";
import { nextCron } from "./agent";
import { createId } from "./ids";
import {
  createJob,
  getJobByIdempotencyKey,
  listQueuedJobs,
  recoverStaleJobs,
} from "./jobs";
import { runBackgroundJob } from "./job-runner";
import {
  listDueRoutineUserIds,
  listUserStores,
  loadMessages,
  mutateStore,
  readStore,
  saveMessages,
} from "./store";

const g = globalThis as typeof globalThis & { __deniScheduler?: boolean };

export function startScheduler() {
  if (g.__deniScheduler || process.env.DENI_SCHEDULER !== "true") return;
  g.__deniScheduler = true;
  setInterval(() => {
    tick().catch((error) => {
      console.error("[deni scheduler]", error);
      void import("./report").then(({ reportError }) => reportError(error, "scheduler"));
    });
  }, 30_000);
  tick().catch(() => undefined);
}

/** Run stale recovery before claiming work so a process restart cannot strand a task. */
export async function tick() {
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

  // Jobs are claimed one at a time in runBackgroundJob; another scheduler process can
  // safely observe the same queue because the claim is protected by a row lock.
  for (const job of await listQueuedJobs()) {
    void runBackgroundJob(job.userId ?? "", job.id).catch((error) => {
      console.error("[deni scheduler] job", job.id, error);
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
  const kickoff: UIMessage = {
    id: createId("msg"),
    role: "user",
    parts: [
      {
        type: "text",
        text: `[Routine ${routine.name}]\n${routine.instructions}\n\nThis is a scheduled run. Do not perform actions that require approval; leave the result behind.`,
      },
    ],
  };
  const previous = await loadMessages(userId, routine.threadId);
  const messages = [...previous, kickoff];
  await saveMessages(userId, routine.threadId, messages);
  const job = await createJob({
    userId,
    threadId: routine.threadId,
    botId: bot.id,
    kind: "routine",
    idempotencyKey,
    payload: { messages, routineId: routine.id, routineRevision, runMode: store.config.runMode },
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
