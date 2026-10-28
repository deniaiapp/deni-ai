import type { AgentJob, AppNotification } from "./types";

export type JobVisualState = "running" | "waiting" | "attention";

const ACTIVE = new Set(["queued", "running", "finalizing"]);
const WAITING = new Set(["waiting_approval", "waiting_takeover"]);
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function timestamp(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function isNewerJob(next: AgentJob, current: AgentJob) {
  return (
    timestamp(next.updatedAt) > timestamp(current.updatedAt) ||
    next.attempt > current.attempt ||
    timestamp(next.startedAt) > timestamp(current.finishedAt)
  );
}

/**
 * Merge a poll response into the local snapshot without allowing a response that was
 * read before a terminal transition to roll the UI back to running. A newer retry is
 * still accepted because its updatedAt/attempt is newer than the old terminal attempt.
 */
export function mergeJobSnapshots(previous: AgentJob[], incoming: AgentJob[]) {
  const byId = new Map(previous.map((job) => [job.id, job]));
  for (const next of incoming) {
    const current = byId.get(next.id);
    if (!current) {
      byId.set(next.id, next);
      continue;
    }
    const currentTerminal = TERMINAL.has(current.status);
    const nextTerminal = TERMINAL.has(next.status);
    if (currentTerminal && !nextTerminal && !isNewerJob(next, current)) continue;
    if (currentTerminal === false && nextTerminal && timestamp(next.updatedAt) < timestamp(current.updatedAt)) {
      continue;
    }
    if (
      timestamp(next.updatedAt) < timestamp(current.updatedAt) &&
      !(nextTerminal && !currentTerminal)
    ) {
      continue;
    }
    byId.set(next.id, next);
  }
  return [...byId.values()].sort(
    (a, b) =>
      timestamp(b.createdAt) - timestamp(a.createdAt) ||
      timestamp(b.updatedAt) - timestamp(a.updatedAt),
  );
}

export function latestJob(jobs: AgentJob[]) {
  return [...jobs].sort(
    (a, b) =>
      timestamp(b.createdAt) - timestamp(a.createdAt) ||
      timestamp(b.updatedAt) - timestamp(a.updatedAt),
  )[0];
}

export function groupJobsByThread(jobs: AgentJob[]) {
  const grouped: Record<string, AgentJob[]> = {};
  for (const job of jobs) (grouped[job.threadId] ??= []).push(job);
  return grouped;
}

export function jobVisualState(jobs: AgentJob[]): JobVisualState | undefined {
  const current = jobs.find((job) => ACTIVE.has(job.status) || WAITING.has(job.status) || job.status === "uncertain");
  if (!current) return undefined;
  if (ACTIVE.has(current.status)) return "running";
  return current.status === "uncertain" ? "attention" : "waiting";
}

export function isActiveJob(job: AgentJob) {
  return ACTIVE.has(job.status) || WAITING.has(job.status);
}

export function shouldMarkThreadUnread(
  previousStatus: AgentJob["status"] | undefined,
  nextStatus: AgentJob["status"],
  threadId: string,
  activeThreadId: string | null,
) {
  return Boolean(
    previousStatus &&
      (ACTIVE.has(previousStatus) || WAITING.has(previousStatus)) &&
      ["completed", "failed", "cancelled"].includes(nextStatus) &&
      threadId !== activeThreadId,
  );
}

/** Unread notifications about jobs in the open thread. The person already sees those results there. */
export function notificationsSeenInThread(notifications: AppNotification[], threadJobs: AgentJob[] | undefined) {
  const jobIds = new Set((threadJobs ?? []).map((job) => job.id));
  return notifications.filter((item) => !item.readAt && item.jobId && jobIds.has(item.jobId)).map((item) => item.id);
}

export function canCommitThreadResponse(activeThreadId: string | null, responseThreadId: string) {
  return activeThreadId === responseThreadId;
}
