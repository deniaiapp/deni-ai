import { hostname } from "node:os";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { runJobEvents, runJobs } from "@deniai/db";
import { translatorFor } from "../i18n/standalone";
import { db } from "../runtime";
import { createId } from "../data/ids";
import type { AgentJob, JobEvent, JobStatus } from "../types";
import { createNotification } from "./notifications";

/**
 * The Run job queue on Postgres. Workers claim queued rows with
 * `FOR UPDATE SKIP LOCKED` inside a transaction, so concurrent schedulers never take
 * the same job; a claim sets a lease (`lease_expires_at`) that heartbeats renew. A
 * lease that runs out while the job is running marks it `uncertain`: the job may have
 * had external side effects, so it is not replayed without review.
 */

/** How long a claim lasts without a heartbeat. */
export const JOB_LEASE_MS = 5 * 60_000;

type JobPayload = Record<string, unknown>;
type JobRow = typeof runJobs.$inferSelect;

/** Statuses that keep a thread busy. */
export const ACTIVE_JOB_STATUSES: JobStatus[] = [
  "queued",
  "running",
  "finalizing",
  "waiting_approval",
  "waiting_takeover",
];

const CANCELLABLE: JobStatus[] = [
  "queued",
  "running",
  "finalizing",
  "paused",
  "uncertain",
  "waiting_approval",
  "waiting_takeover",
];

/** This process's lease owner id. */
export const WORKER_ID = `${hostname()}:${process.pid}:${createId().slice(0, 6)}`;

const jobSummaryColumns = {
  ...getTableColumns(runJobs),
  // Job payloads contain entire conversations. Never fetch them for a status poll.
  payload: sql<JobPayload>`'{}'::jsonb`.mapWith(() => ({}) as JobPayload),
  result: sql<Record<string, unknown> | null>`NULL`.mapWith(() => null),
  checkpoint: sql<Record<
    string,
    unknown
  > | null>`CASE WHEN ${runJobs.checkpoint} IS NULL THEN NULL ELSE jsonb_build_object('text', left(coalesce(${runJobs.checkpoint} ->> 'text', ''), 2000), 'step', ${runJobs.checkpoint} -> 'step', 'updatedAt', ${runJobs.checkpoint} -> 'updatedAt') END`.mapWith(
    (value: unknown) =>
      typeof value === "string"
        ? (JSON.parse(value) as Record<string, unknown>)
        : ((value as Record<string, unknown> | null) ?? null),
  ),
};

function asDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

function mapJob(row: JobRow): AgentJob {
  return {
    id: row.id,
    userId: row.userId,
    threadId: row.threadId,
    botId: row.teammateId,
    kind: row.kind,
    status: row.status,
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

function mapEvent(row: typeof runJobEvents.$inferSelect): JobEvent {
  return {
    id: row.id,
    jobId: row.jobId,
    kind: row.kind,
    payload: row.payload,
    sequence: row.sequence,
    createdAt: row.createdAt.toISOString(),
  };
}

const leaseUntil = (at: Date) => new Date(at.getTime() + JOB_LEASE_MS);

export async function getJob(userId: string, jobId: string) {
  const rows = await db
    .select()
    .from(runJobs)
    .where(and(eq(runJobs.userId, userId), eq(runJobs.id, jobId)))
    .limit(1);
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function getJobByIdempotencyKey(userId: string, idempotencyKey: string) {
  const rows = await db
    .select()
    .from(runJobs)
    .where(and(eq(runJobs.userId, userId), eq(runJobs.idempotencyKey, idempotencyKey)))
    .limit(1);
  return rows[0] ? mapJob(rows[0]) : null;
}

/** Whether any job in the thread is still running or parked waiting for the person. */
export async function hasActiveThreadJob(userId: string, threadId: string) {
  const rows = await db
    .select({ id: runJobs.id })
    .from(runJobs)
    .where(
      and(
        eq(runJobs.userId, userId),
        eq(runJobs.threadId, threadId),
        inArray(runJobs.status, ACTIVE_JOB_STATUSES),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function listJobs(
  userId: string,
  options?: { threadId?: string; limit?: number; summary?: boolean },
) {
  const conditions = [eq(runJobs.userId, userId)];
  if (options?.threadId) conditions.push(eq(runJobs.threadId, options.threadId));
  const rows = await db
    .select(options?.summary ? jobSummaryColumns : getTableColumns(runJobs))
    .from(runJobs)
    .where(and(...conditions))
    .orderBy(desc(runJobs.createdAt))
    .limit(Math.min(Math.max(options?.limit ?? 50, 1), 200));
  return rows.map(mapJob);
}

/** Return recent history plus every active job so an old long-running task never disappears. */
export async function listJobOverview(userId: string, limit = 200, summary = false) {
  const recentIds = db
    .select({ id: runJobs.id })
    .from(runJobs)
    .where(eq(runJobs.userId, userId))
    .orderBy(desc(runJobs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  const rows = await db
    .select(summary ? jobSummaryColumns : getTableColumns(runJobs))
    .from(runJobs)
    .where(
      and(
        eq(runJobs.userId, userId),
        or(inArray(runJobs.status, ACTIVE_JOB_STATUSES), inArray(runJobs.id, recentIds)),
      ),
    )
    .orderBy(desc(runJobs.createdAt));
  return rows.map(mapJob);
}

/** Queued jobs that may run now, oldest first (read-only; claim with {@link claimNextJobs}). */
export async function listQueuedJobs(limit = 100, at = new Date()) {
  const rows = await db
    .select()
    .from(runJobs)
    .where(and(eq(runJobs.status, "queued"), lte(runJobs.runAfter, at)))
    .orderBy(asc(runJobs.runAfter), asc(runJobs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.map(mapJob);
}

type NewJob = {
  userId: string;
  threadId: string;
  botId: string;
  kind: AgentJob["kind"];
  payload: JobPayload;
  idempotencyKey: string;
  maxAttempts?: number;
};

async function insertJob(options: NewJob, claim: boolean) {
  const id = createId("job");
  const now = new Date();
  const inserted = await db
    .insert(runJobs)
    .values({
      id,
      userId: options.userId,
      threadId: options.threadId,
      teammateId: options.botId,
      kind: options.kind,
      status: claim ? "running" : "queued",
      payload: options.payload,
      attempt: claim ? 1 : 0,
      maxAttempts: options.maxAttempts ?? 3,
      idempotencyKey: options.idempotencyKey,
      lockedBy: claim ? WORKER_ID : null,
      lockedAt: claim ? now : null,
      leaseExpiresAt: claim ? leaseUntil(now) : null,
      heartbeatAt: claim ? now : null,
      startedAt: claim ? now : null,
      runAfter: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [runJobs.userId, runJobs.idempotencyKey] })
    .returning();
  if (inserted[0]) return { job: mapJob(inserted[0]), created: true };
  const existing = await getJobByIdempotencyKey(options.userId, options.idempotencyKey);
  if (!existing) throw new Error("Unable to persist job");
  return { job: existing, created: false };
}

/**
 * Queues a job for the background scheduler. The idempotency key is unique per user:
 * creating the same job twice returns the first one.
 */
export async function createJob(options: NewJob) {
  return (await insertJob(options, false)).job;
}

/**
 * Creates a job that the caller runs itself. It starts out running with this process's
 * lease, so the scheduler never sees it queued. When a job with the same idempotency key
 * already exists, that job is returned with `claimed: false`.
 */
export async function createClaimedJob(options: NewJob) {
  const { job, created } = await insertJob(options, true);
  return { job, claimed: created };
}

/**
 * Claim up to `limit` runnable queued jobs for this worker. `FOR UPDATE SKIP LOCKED`
 * makes concurrent claimers skip each other's rows instead of waiting or double-claiming.
 */
export async function claimNextJobs(limit: number, options?: { workerId?: string; at?: Date }) {
  if (limit <= 0) return [];
  const at = options?.at ?? new Date();
  const workerId = options?.workerId ?? WORKER_ID;
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: runJobs.id })
      .from(runJobs)
      .where(
        and(
          eq(runJobs.status, "queued"),
          lte(runJobs.runAfter, at),
          sql`${runJobs.attempt} < ${runJobs.maxAttempts}`,
        ),
      )
      .orderBy(asc(runJobs.runAfter), asc(runJobs.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (!candidates.length) return [];
    const rows = await tx
      .update(runJobs)
      .set({
        status: "running",
        attempt: sql`${runJobs.attempt} + 1`,
        lockedBy: workerId,
        lockedAt: at,
        leaseExpiresAt: leaseUntil(at),
        heartbeatAt: at,
        startedAt: sql`coalesce(${runJobs.startedAt}, ${at.toISOString()}::timestamptz)`,
        error: null,
        updatedAt: at,
      })
      .where(
        inArray(
          runJobs.id,
          candidates.map((row) => row.id),
        ),
      )
      .returning();
    return rows.map(mapJob);
  });
}

/**
 * Claim one specific job: a queued job (the retry endpoint), a running job whose lease
 * expired, or — with `continuation` — a job parked in `waiting_approval` /
 * `waiting_takeover` that the person just answered. The row is locked while deciding.
 */
export async function claimJob(
  userId: string,
  jobId: string,
  continuation?: {
    from: "waiting_takeover" | "waiting_approval";
    threadId: string;
    botId: string;
    key: string;
    payload: Record<string, unknown>;
  },
  options?: { workerId?: string; at?: Date },
) {
  const at = options?.at ?? new Date();
  const workerId = options?.workerId ?? WORKER_ID;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(runJobs)
      .where(and(eq(runJobs.userId, userId), eq(runJobs.id, jobId)))
      .for("update");
    if (!row) return null;
    if (
      continuation &&
      (row.threadId !== continuation.threadId ||
        row.teammateId !== continuation.botId ||
        row.status !== continuation.from ||
        row.payload.continuationKey === continuation.key)
    ) {
      return { job: mapJob(row), claimed: false };
    }
    const expired =
      row.status === "running" &&
      (!row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= at.getTime());
    if (!continuation) {
      if (row.status !== "queued" && !expired) return { job: mapJob(row), claimed: false };
      if (row.attempt >= row.maxAttempts && !expired) return { job: mapJob(row), claimed: false };
      if (row.runAfter.getTime() > at.getTime() && !expired)
        return { job: mapJob(row), claimed: false };
    }
    const [claimed] = await tx
      .update(runJobs)
      .set({
        status: "running",
        attempt: continuation ? row.attempt : row.attempt + 1,
        ...(continuation
          ? {
              payload: {
                ...row.payload,
                ...continuation.payload,
                continuationKey: continuation.key,
              },
            }
          : {}),
        lockedBy: workerId,
        lockedAt: at,
        leaseExpiresAt: leaseUntil(at),
        heartbeatAt: at,
        startedAt: row.startedAt ?? at,
        updatedAt: at,
        error: null,
      })
      .where(eq(runJobs.id, row.id))
      .returning();
    return claimed ? { job: mapJob(claimed), claimed: true } : { job: mapJob(row), claimed: false };
  });
}

type JobPatch = Partial<{
  payload: Record<string, unknown>;
  status: JobStatus;
  result: Record<string, unknown> | null;
  checkpoint: Record<string, unknown> | null;
  error: string | null;
  lockedAt: Date | null;
  heartbeatAt: Date | null;
  finishedAt: Date | null;
}>;

function releaseLease(patch: JobPatch) {
  // Leaving running/finalizing gives the lease back.
  return patch.status && patch.status !== "running" && patch.status !== "finalizing"
    ? { lockedBy: null, lockedAt: null, leaseExpiresAt: null }
    : {};
}

export async function updateJob(userId: string, jobId: string, patch: JobPatch) {
  const [row] = await db
    .update(runJobs)
    .set({ ...patch, ...releaseLease(patch), updatedAt: new Date() })
    .where(and(eq(runJobs.userId, userId), eq(runJobs.id, jobId)))
    .returning();
  return row ? mapJob(row) : null;
}

/** Transition a job only if it is still in one of the expected states. */
export async function transitionJob(
  userId: string,
  jobId: string,
  from: JobStatus | JobStatus[],
  patch: JobPatch,
) {
  const states = Array.isArray(from) ? from : [from];
  const [row] = await db
    .update(runJobs)
    .set({ ...patch, ...releaseLease(patch), updatedAt: new Date() })
    .where(and(eq(runJobs.userId, userId), eq(runJobs.id, jobId), inArray(runJobs.status, states)))
    .returning();
  return row ? mapJob(row) : null;
}

/** Renew the lease of a running job. Returns null once the job was cancelled or taken over. */
export async function heartbeatJob(userId: string, jobId: string, at = new Date()) {
  const [row] = await db
    .update(runJobs)
    .set({ heartbeatAt: at, leaseExpiresAt: leaseUntil(at), updatedAt: at })
    .where(
      and(
        eq(runJobs.userId, userId),
        eq(runJobs.id, jobId),
        inArray(runJobs.status, ["running", "finalizing"]),
      ),
    )
    .returning();
  return row ? mapJob(row) : null;
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

/** Save progress after a step (resume point and UI progress); also renews the lease. */
export async function checkpointJob(
  userId: string,
  jobId: string,
  checkpoint: Record<string, unknown>,
  eventKind = "checkpoint",
) {
  const at = new Date();
  const [row] = await db
    .update(runJobs)
    .set({ checkpoint, heartbeatAt: at, leaseExpiresAt: leaseUntil(at), updatedAt: at })
    .where(
      and(
        eq(runJobs.userId, userId),
        eq(runJobs.id, jobId),
        inArray(runJobs.status, ["running", "finalizing"]),
      ),
    )
    .returning();
  if (row) await appendJobEvent(userId, jobId, eventKind, checkpoint);
  return row ? mapJob(row) : null;
}

/**
 * Append an event with the next per-job sequence number. The job row is locked while the
 * number is chosen, so concurrent writers of the same job queue up.
 */
export async function appendJobEvent(
  userId: string,
  jobId: string,
  kind: string,
  payload: JobPayload = {},
) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({ id: runJobs.id })
      .from(runJobs)
      .where(and(eq(runJobs.userId, userId), eq(runJobs.id, jobId)))
      .for("update");
    if (!job) return null;
    const [last] = await tx
      .select({ sequence: sql<number>`coalesce(max(${runJobEvents.sequence}), 0)`.mapWith(Number) })
      .from(runJobEvents)
      .where(eq(runJobEvents.jobId, jobId));
    const [row] = await tx
      .insert(runJobEvents)
      .values({
        id: createId("evt"),
        userId,
        jobId,
        kind,
        payload,
        sequence: (last?.sequence ?? 0) + 1,
      })
      .returning();
    return row ? mapEvent(row) : null;
  });
}

export async function listJobEvents(userId: string, jobId: string, after = 0) {
  const rows = await db
    .select()
    .from(runJobEvents)
    .where(
      and(
        eq(runJobEvents.userId, userId),
        eq(runJobEvents.jobId, jobId),
        gt(runJobEvents.sequence, after),
      ),
    )
    .orderBy(asc(runJobEvents.sequence));
  return rows.map(mapEvent);
}

/**
 * Cancel a job. A running job's worker sees the status at its next step (or heartbeat)
 * and stops; `cancel_requested_at` records when the person asked.
 */
export async function cancelJob(userId: string, jobId: string, locale?: string) {
  const now = new Date();
  const [row] = await db
    .update(runJobs)
    .set({
      status: "cancelled",
      error: translatorFor(locale)("Cancelled by user"),
      cancelRequestedAt: now,
      finishedAt: now,
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(
      and(eq(runJobs.userId, userId), eq(runJobs.id, jobId), inArray(runJobs.status, CANCELLABLE)),
    )
    .returning();
  if (row) await appendJobEvent(userId, jobId, "cancelled", { reason: "user" });
  return row ? mapJob(row) : null;
}

/** Whether the job was cancelled (or deleted) since it was claimed. */
export async function isJobCancelled(userId: string, jobId: string) {
  const job = await getJob(userId, jobId);
  return !job || job.status === "cancelled";
}

/**
 * Queue a failed (or reviewed uncertain) job again. `delayMs` backs the next claim off;
 * the attempt counter is only bumped when a worker claims it.
 */
export async function retryJob(
  userId: string,
  jobId: string,
  options?: { reviewed?: boolean; delayMs?: number },
) {
  const current = await getJob(userId, jobId);
  if (!current) return null;
  if (!["failed", "uncertain"].includes(current.status) || current.attempt >= current.maxAttempts) {
    return current;
  }
  if (current.status === "uncertain" && !options?.reviewed) return current;
  const now = new Date();
  const [row] = await db
    .update(runJobs)
    .set({
      status: "queued",
      error: null,
      result: null,
      finishedAt: null,
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      runAfter: new Date(now.getTime() + Math.max(0, options?.delayMs ?? 0)),
      updatedAt: now,
    })
    .where(
      and(
        eq(runJobs.userId, userId),
        eq(runJobs.id, jobId),
        inArray(runJobs.status, ["failed", "uncertain"]),
      ),
    )
    .returning();
  if (row) await appendJobEvent(userId, jobId, "retry_queued", { attempt: row.attempt + 1 });
  return row ? mapJob(row) : current;
}

/**
 * Jobs whose lease ran out while running become `uncertain` (never replayed blindly),
 * with an event and a notification. Rows are locked with SKIP LOCKED so two schedulers
 * recover each job once.
 */
export async function recoverStaleJobs(at = new Date()) {
  const recovered = await db.transaction(async (tx) => {
    const stale = await tx
      .select()
      .from(runJobs)
      .where(
        and(
          inArray(runJobs.status, ["running", "finalizing"]),
          or(isNull(runJobs.leaseExpiresAt), lte(runJobs.leaseExpiresAt, at)),
        ),
      )
      .limit(100)
      .for("update", { skipLocked: true });
    for (const job of stale) {
      const tr = translatorFor(job.payload.locale);
      await tx
        .update(runJobs)
        .set({
          status: "uncertain",
          error: tr(
            "Worker lease expired; review this task before retrying to avoid duplicate side effects",
          ),
          lockedBy: null,
          lockedAt: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          finishedAt: null,
          updatedAt: at,
        })
        .where(eq(runJobs.id, job.id));
    }
    return stale;
  });
  for (const job of recovered) {
    const tr = translatorFor(job.payload.locale);
    await appendJobEvent(job.userId, job.id, "uncertain", {
      reason: "worker_lease_expired",
      checkpoint: job.checkpoint ?? {},
    }).catch(() => undefined);
    await createNotification({
      userId: job.userId,
      jobId: job.id,
      kind: "failed",
      title: tr("Task needs review before retry"),
      body: tr(
        "The worker stopped unexpectedly after a checkpoint. Review external side effects, then retry explicitly.",
      ),
    }).catch(() => undefined);
  }
  return recovered.length;
}
