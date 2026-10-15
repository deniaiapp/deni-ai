import "@tanstack/react-start/server-only";

import { translatorFor } from "./i18n-server";
import { and, asc, desc, eq, getTableColumns, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentJobs, jobEvents } from "@/db/schema";
import { createId } from "./ids";
import type { AgentJob, JobEvent, JobStatus } from "./types";
import { createNotification } from "./notifications";

const LEASE_MS = 5 * 60_000;

type JobPayload = Record<string, unknown>;

const jobSummaryColumns = {
  ...getTableColumns(agentJobs),
  // Job payloads contain entire conversations. Never fetch them for a status poll.
  payload: sql<JobPayload>`'{}'`.mapWith(() => ({}) as JobPayload),
  result: sql<Record<string, unknown> | null>`NULL`.mapWith(() => null),
  checkpoint: sql<Record<string, unknown> | null>`CASE WHEN ${agentJobs.checkpoint} IS NULL THEN NULL ELSE json_object('text', substr(coalesce(${agentJobs.checkpoint} ->> '$.text', ''), 1, 2000), 'step', ${agentJobs.checkpoint} -> '$.step', 'updatedAt', ${agentJobs.checkpoint} -> '$.updatedAt') END`.mapWith((value: unknown) =>
    typeof value === "string" ? (JSON.parse(value) as Record<string, unknown>) : null,
  ),
};

function asDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

function mapJob(row: typeof agentJobs.$inferSelect): AgentJob {
  return {
    id: row.id,
    userId: row.userId,
    threadId: row.threadId,
    botId: row.botId,
    kind: row.kind as AgentJob["kind"],
    status: row.status as JobStatus,
    payload: row.payload,
    result: row.result,
    checkpoint: row.checkpoint,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    idempotencyKey: row.idempotencyKey,
    error: row.error,
    lockedAt: asDate(row.lockedAt),
    heartbeatAt: asDate(row.heartbeatAt),
    startedAt: asDate(row.startedAt),
    finishedAt: asDate(row.finishedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapEvent(row: typeof jobEvents.$inferSelect): JobEvent {
  return {
    id: row.id,
    jobId: row.jobId,
    kind: row.kind,
    payload: row.payload,
    sequence: row.sequence,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getJob(userId: string, jobId: string) {
  const rows = await db
    .select()
    .from(agentJobs)
    .where(and(eq(agentJobs.userId, userId), eq(agentJobs.id, jobId)))
    .limit(1);
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function getJobByIdempotencyKey(userId: string, idempotencyKey: string) {
  const rows = await db
    .select()
    .from(agentJobs)
    .where(and(eq(agentJobs.userId, userId), eq(agentJobs.idempotencyKey, idempotencyKey)))
    .limit(1);
  return rows[0] ? mapJob(rows[0]) : null;
}

/** Whether any job in the thread is still running or parked waiting for the person. */
export async function hasActiveThreadJob(userId: string, threadId: string) {
  const rows = await db
    .select({ id: agentJobs.id })
    .from(agentJobs)
    .where(and(
      eq(agentJobs.userId, userId),
      eq(agentJobs.threadId, threadId),
      inArray(agentJobs.status, ["queued", "running", "finalizing", "waiting_approval", "waiting_takeover"]),
    ))
    .limit(1);
  return rows.length > 0;
}

export async function listJobs(userId: string, options?: { threadId?: string; limit?: number; summary?: boolean }) {
  const conditions = [eq(agentJobs.userId, userId)];
  if (options?.threadId) conditions.push(eq(agentJobs.threadId, options.threadId));
  const rows = await db
    .select(options?.summary ? jobSummaryColumns : getTableColumns(agentJobs))
    .from(agentJobs)
    .where(and(...conditions))
    .orderBy(desc(agentJobs.createdAt))
    .limit(Math.min(Math.max(options?.limit ?? 50, 1), 200));
  return rows.map(mapJob);
}

/** Return recent history plus every active job so an old long-running task never disappears. */
export async function listJobOverview(userId: string, limit = 200, summary = false) {
  const recentIds = db.select({ id: agentJobs.id })
    .from(agentJobs)
    .where(eq(agentJobs.userId, userId))
    .orderBy(desc(agentJobs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  const rows = await db.select(summary ? jobSummaryColumns : getTableColumns(agentJobs))
    .from(agentJobs)
    .where(and(eq(agentJobs.userId, userId), or(
      inArray(agentJobs.status, ["queued", "running", "finalizing", "waiting_approval", "waiting_takeover"]),
      inArray(agentJobs.id, recentIds),
    )))
    .orderBy(desc(agentJobs.createdAt));
  return rows.map(mapJob);
}

export async function listQueuedJobs(limit = 100) {
  const rows = await db
    .select()
    .from(agentJobs)
    .where(eq(agentJobs.status, "queued"))
    .orderBy(asc(agentJobs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.map(mapJob);
}

export async function createJob(options: {
  userId: string;
  threadId: string;
  botId: string;
  kind: AgentJob["kind"];
  payload: JobPayload;
  idempotencyKey: string;
  maxAttempts?: number;
}) {
  const id = createId("job");
  await db
    .insert(agentJobs)
    .values({
      id,
      userId: options.userId,
      threadId: options.threadId,
      botId: options.botId,
      kind: options.kind,
      status: "queued",
      payload: options.payload,
      result: null,
      checkpoint: null,
      attempt: 0,
      maxAttempts: options.maxAttempts ?? 3,
      idempotencyKey: options.idempotencyKey,
      error: null,
      lockedAt: null,
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: [agentJobs.userId, agentJobs.idempotencyKey] });
  const rows = await db
    .select()
    .from(agentJobs)
    .where(and(eq(agentJobs.userId, options.userId), eq(agentJobs.idempotencyKey, options.idempotencyKey)))
    .limit(1);
  if (!rows[0]) throw new Error("Unable to persist job");
  return mapJob(rows[0]);
}

export async function claimJob(userId: string, jobId: string, continuation?: {
  from: "waiting_takeover" | "waiting_approval";
  threadId: string;
  botId: string;
  key: string;
  payload: Record<string, unknown>;
}) {
  // No row lock on D1: decide from a read, then make the UPDATE itself the guard by
  // repeating the observed state in its WHERE clause. If another worker got there first
  // the update matches nothing and the caller sees the winner's job instead.
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await db
      .select()
      .from(agentJobs)
      .where(and(eq(agentJobs.userId, userId), eq(agentJobs.id, jobId)));
    if (!row) return null;
    if (continuation && (row.threadId !== continuation.threadId || row.botId !== continuation.botId || row.status !== continuation.from || row.payload.continuationKey === continuation.key)) {
      return { job: mapJob(row), claimed: false };
    }
    const staleBefore = new Date(Date.now() - LEASE_MS);
    const stale = row.status === "running" && (!row.heartbeatAt || row.heartbeatAt < staleBefore);
    if (!continuation && row.status !== "queued" && !stale) return { job: mapJob(row), claimed: false };
    if (!continuation && row.attempt >= row.maxAttempts && !stale) {
      return { job: mapJob(row), claimed: false };
    }
    const now = new Date();
    const [claimed] = await db
      .update(agentJobs)
      .set({
        status: "running",
        attempt: continuation ? row.attempt : row.attempt + 1,
        ...(continuation ? { payload: { ...row.payload, ...continuation.payload, continuationKey: continuation.key } } : {}),
        lockedAt: now,
        heartbeatAt: now,
        startedAt: row.startedAt ?? now,
        updatedAt: now,
        error: null,
      })
      .where(
        and(
          eq(agentJobs.userId, userId),
          eq(agentJobs.id, jobId),
          eq(agentJobs.status, row.status),
          eq(agentJobs.attempt, row.attempt),
          row.heartbeatAt ? eq(agentJobs.heartbeatAt, row.heartbeatAt) : isNull(agentJobs.heartbeatAt),
          eq(agentJobs.updatedAt, row.updatedAt),
        ),
      )
      .returning();
    if (claimed) return { job: mapJob(claimed), claimed: true };
  }
  const latest = await getJob(userId, jobId);
  return latest ? { job: latest, claimed: false } : null;
}

export async function updateJob(
  userId: string,
  jobId: string,
  patch: Partial<{
    payload: Record<string, unknown>;
    status: JobStatus;
    result: Record<string, unknown> | null;
    checkpoint: Record<string, unknown> | null;
    error: string | null;
    lockedAt: Date | null;
    heartbeatAt: Date | null;
    finishedAt: Date | null;
  }>,
) {
  const [row] = await db
    .update(agentJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(agentJobs.userId, userId), eq(agentJobs.id, jobId)))
    .returning();
  return row ? mapJob(row) : null;
}

/** Transition a job only if it is still in one of the expected states. */
export async function transitionJob(
  userId: string,
  jobId: string,
  from: JobStatus | JobStatus[],
  patch: Partial<{
    payload: Record<string, unknown>;
    status: JobStatus;
    result: Record<string, unknown> | null;
    checkpoint: Record<string, unknown> | null;
    error: string | null;
    lockedAt: Date | null;
    heartbeatAt: Date | null;
    finishedAt: Date | null;
  }>,
) {
  const states = Array.isArray(from) ? from : [from];
  const [row] = await db
    .update(agentJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(agentJobs.userId, userId),
        eq(agentJobs.id, jobId),
        inArray(agentJobs.status, states),
      ),
    )
    .returning();
  return row ? mapJob(row) : null;
}

export async function heartbeatJob(userId: string, jobId: string) {
  return transitionJob(userId, jobId, ["running", "finalizing"], { heartbeatAt: new Date() });
}

export async function finishJob(
  userId: string,
  jobId: string,
  status: Extract<JobStatus, "completed" | "failed" | "cancelled">,
  options?: { result?: Record<string, unknown> | null; error?: string | null },
) {
  return transitionJob(userId, jobId, ["running", "finalizing"], {
    status,
    result: options?.result ?? null,
    error: options?.error ?? null,
    finishedAt: new Date(),
    heartbeatAt: null,
    lockedAt: null,
  });
}

export async function checkpointJob(
  userId: string,
  jobId: string,
  checkpoint: Record<string, unknown>,
  eventKind = "checkpoint",
) {
  const job = await transitionJob(userId, jobId, ["running", "finalizing"], {
    checkpoint,
    heartbeatAt: new Date(),
  });
  if (job) await appendJobEvent(userId, jobId, eventKind, checkpoint);
  return job;
}

export async function appendJobEvent(
  userId: string,
  jobId: string,
  kind: string,
  payload: JobPayload = {},
) {
  // The next sequence is computed inside the INSERT itself, and the unique
  // (user, job, sequence) index rejects a concurrent writer that picked the same number.
  // The loser simply retries with the new maximum.
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const [row] = await db
        .insert(jobEvents)
        .values({
          id: createId("evt"),
          userId,
          jobId,
          kind,
          payload,
          sequence: sql`(select coalesce(max(${jobEvents.sequence}), 0) + 1 from ${jobEvents} where ${jobEvents.userId} = ${userId} and ${jobEvents.jobId} = ${jobId})`,
        })
        .returning();
      return row ? mapEvent(row) : null;
    } catch (error) {
      if (!/UNIQUE constraint failed/i.test(String((error as Error)?.message))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
  throw new Error("Unable to record job event");
}

export async function listJobEvents(userId: string, jobId: string, after = 0) {
  const rows = await db
    .select()
    .from(jobEvents)
    .where(
      and(eq(jobEvents.userId, userId), eq(jobEvents.jobId, jobId), gt(jobEvents.sequence, after)),
    )
    .orderBy(asc(jobEvents.sequence));
  return rows.map(mapEvent);
}

export async function cancelJob(userId: string, jobId: string, locale?: string) {
  const [row] = await db
    .update(agentJobs)
    .set({ status: "cancelled", error: translatorFor(locale)("Cancelled by user"), finishedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(agentJobs.userId, userId),
        eq(agentJobs.id, jobId),
        inArray(agentJobs.status, ["queued", "running", "paused", "uncertain", "waiting_approval", "waiting_takeover"]),
      ),
    )
    .returning();
  if (row) await appendJobEvent(userId, jobId, "cancelled", { reason: "user" });
  return row ? mapJob(row) : null;
}

export async function retryJob(userId: string, jobId: string, options?: { reviewed?: boolean }) {
  const current = await getJob(userId, jobId);
  if (!current) return null;
  if (!["failed", "uncertain"].includes(current.status) || current.attempt >= current.maxAttempts) {
    return current;
  }
  if (current.status === "uncertain" && !options?.reviewed) return current;
  const [row] = await db
    .update(agentJobs)
    .set({
      status: "queued",
      error: null,
      result: null,
      finishedAt: null,
      lockedAt: null,
      heartbeatAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentJobs.userId, userId),
        eq(agentJobs.id, jobId),
        inArray(agentJobs.status, ["failed", "uncertain"]),
      ),
    )
    .returning();
  if (row) await appendJobEvent(userId, jobId, "retry_queued", { attempt: row.attempt + 1 });
  return row ? mapJob(row) : current;
}

export async function recoverStaleJobs(at = new Date()) {
  const cutoff = new Date(at.getTime() - LEASE_MS);
  const stale = await db
    .select()
    .from(agentJobs)
    .where(
      and(
        inArray(agentJobs.status, ["running", "finalizing"]),
        or(isNull(agentJobs.heartbeatAt), lt(agentJobs.heartbeatAt, cutoff)),
      ),
    )
    .limit(100);
  for (const job of stale) {
    const tr = translatorFor(job.payload.locale);
    const nextStatus: JobStatus = "uncertain";
    await db
      .update(agentJobs)
      .set({
        status: nextStatus,
        error: tr("Worker lease expired; review this task before retrying to avoid duplicate side effects"),
        lockedAt: null,
        heartbeatAt: null,
        updatedAt: at,
        finishedAt: null,
      })
      .where(and(eq(agentJobs.id, job.id), inArray(agentJobs.status, ["running", "finalizing"])));
    await appendJobEvent(job.userId, job.id, "uncertain", {
      reason: "worker_lease_expired",
      checkpoint: job.checkpoint ?? {},
    }).catch(() => undefined);
    await createNotification({
      userId: job.userId,
      jobId: job.id,
      kind: "failed",
      title: tr("Task needs review before retry"),
      body: tr("The worker stopped unexpectedly after a checkpoint. Review external side effects, then retry explicitly."),
    }).catch(() => undefined);
  }
  return stale.length;
}

export const JOB_LEASE_MS = LEASE_MS;
