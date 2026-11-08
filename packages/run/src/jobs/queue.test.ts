import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  configureRunForTest,
  createRunTestDb,
  resetRunTables,
  seedTestUser,
  type RunTestDb,
} from "../testing";
import { deleteGroupThread, mutateStore, readStore } from "../data/store";
import {
  appendJobEvent,
  cancelJob,
  checkpointJob,
  claimJob,
  claimNextJobs,
  createClaimedJob,
  createJob,
  finishJob,
  getJob,
  heartbeatJob,
  JOB_LEASE_MS,
  listJobEvents,
  recoverStaleJobs,
  retryJob,
} from "./index";
import { listNotifications } from "./notifications";

let testDb: RunTestDb;
const USER = "user-queue";

beforeAll(async () => {
  testDb = await createRunTestDb();
  configureRunForTest(testDb);
}, 60_000);

afterAll(async () => {
  await testDb.pglite.close();
});

beforeEach(async () => {
  await resetRunTables(testDb.pglite);
  await seedTestUser(testDb.pglite, USER);
  await readStore(USER); // seeds teammates and DMs
});

const job = (key: string, extra: Partial<Parameters<typeof createJob>[0]> = {}) =>
  createJob({
    userId: USER,
    threadId: "dm_chief",
    botId: "chief",
    kind: "chat",
    payload: { locale: "en" },
    idempotencyKey: key,
    ...extra,
  });

describe("run job queue", () => {
  it("returns the first job for a repeated idempotency key", async () => {
    const first = await job("k1");
    const second = await job("k1", { payload: { other: true } });
    expect(second.id).toBe(first.id);
    expect(second.payload).toEqual({ locale: "en" });
    const claimed = await createClaimedJob({
      userId: USER,
      threadId: "dm_chief",
      botId: "chief",
      kind: "chat",
      payload: {},
      idempotencyKey: "k1",
    });
    expect(claimed).toMatchObject({ claimed: false, job: { id: first.id } });
  });

  it("claims each queued job once across concurrent claimers (SKIP LOCKED)", async () => {
    for (let index = 0; index < 5; index++) await job(`c${index}`);
    const [a, b] = await Promise.all([
      claimNextJobs(3, { workerId: "worker-a" }),
      claimNextJobs(3, { workerId: "worker-b" }),
    ]);
    const ids = [...a, ...b].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5);
    for (const claimed of [...a, ...b]) {
      expect(claimed.status).toBe("running");
      expect(claimed.attempt).toBe(1);
    }
    expect(await claimNextJobs(3)).toEqual([]);
  });

  it("does not claim a job before its retry backoff or past its attempts", async () => {
    const queued = await job("backoff", { maxAttempts: 1 });
    const [claimed] = await claimNextJobs(1);
    expect(claimed?.id).toBe(queued.id);
    await finishJob(USER, queued.id, "failed", { error: "boom" });
    // attempt 1 of 1: an explicit retry is refused.
    expect((await retryJob(USER, queued.id))?.status).toBe("failed");

    const other = await job("backoff-2");
    await claimNextJobs(1);
    await finishJob(USER, other.id, "failed", { error: "boom" });
    const retried = await retryJob(USER, other.id, { delayMs: 60_000 });
    expect(retried?.status).toBe("queued");
    expect(await claimNextJobs(1)).toEqual([]);
    const later = await claimNextJobs(1, { at: new Date(Date.now() + 61_000) });
    expect(later.map((item) => item.id)).toEqual([other.id]);
    expect(later[0]?.attempt).toBe(2);
  });

  it("renews the lease on heartbeat and checkpoint, and records ordered events", async () => {
    const queued = await job("lease");
    const [claimed] = await claimNextJobs(1);
    expect(claimed?.id).toBe(queued.id);
    const beat = await heartbeatJob(USER, queued.id);
    expect(beat?.heartbeatAt).not.toBeNull();
    await checkpointJob(USER, queued.id, { step: 1, text: "half way" });
    await Promise.all([
      appendJobEvent(USER, queued.id, "a"),
      appendJobEvent(USER, queued.id, "b"),
      appendJobEvent(USER, queued.id, "c"),
    ]);
    const events = await listJobEvents(USER, queued.id);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(events[0]).toMatchObject({ kind: "checkpoint", payload: { step: 1, text: "half way" } });
    expect((await getJob(USER, queued.id))?.checkpoint).toEqual({ step: 1, text: "half way" });
  });

  it("marks a job whose lease expired as uncertain and notifies, once", async () => {
    const queued = await job("stale");
    await claimNextJobs(1);
    const future = new Date(Date.now() + JOB_LEASE_MS + 1_000);
    const [first, second] = await Promise.all([recoverStaleJobs(future), recoverStaleJobs(future)]);
    expect(first + second).toBe(1);
    const current = await getJob(USER, queued.id);
    expect(current?.status).toBe("uncertain");
    expect(current?.lockedAt).toBeNull();
    const notifications = await listNotifications(USER);
    expect(notifications.map((item) => item.title)).toEqual(["Task needs review before retry"]);
    // An uncertain job is only retried after review.
    expect((await retryJob(USER, queued.id))?.status).toBe("uncertain");
    expect((await retryJob(USER, queued.id, { reviewed: true }))?.status).toBe("queued");
  });

  it("does not recover a job whose heartbeat keeps the lease alive", async () => {
    const queued = await job("alive");
    await claimNextJobs(1);
    expect(await recoverStaleJobs(new Date(Date.now() + JOB_LEASE_MS / 2))).toBe(0);
    expect((await getJob(USER, queued.id))?.status).toBe("running");
  });

  it("re-claims a running job only after its lease expired", async () => {
    const queued = await job("reclaim");
    await claimNextJobs(1, { workerId: "worker-a" });
    expect((await claimJob(USER, queued.id))?.claimed).toBe(false);
    const later = new Date(Date.now() + JOB_LEASE_MS + 1_000);
    const again = await claimJob(USER, queued.id, undefined, { at: later, workerId: "worker-b" });
    expect(again).toMatchObject({ claimed: true, job: { attempt: 2, status: "running" } });
  });

  it("cancels queued and running jobs; a cancelled job cannot be finished or claimed", async () => {
    const queued = await job("cancel-queued");
    expect((await cancelJob(USER, queued.id))?.status).toBe("cancelled");
    expect(await claimNextJobs(1)).toEqual([]);

    const running = await job("cancel-running");
    await claimNextJobs(1);
    await cancelJob(USER, running.id);
    expect(await heartbeatJob(USER, running.id)).toBeNull();
    expect(await finishJob(USER, running.id, "completed")).toBeNull();
    const current = await getJob(USER, running.id);
    expect(current?.status).toBe("cancelled");
    const events = await listJobEvents(USER, running.id);
    expect(events.at(-1)?.kind).toBe("cancelled");
  });

  it("resumes a job parked for approval exactly once per continuation key", async () => {
    const queued = await job("approval");
    await claimNextJobs(1);
    await testDb.pglite.query(`UPDATE run_jobs SET status = 'waiting_approval' WHERE id = $1`, [
      queued.id,
    ]);
    const continuation = {
      from: "waiting_approval" as const,
      threadId: "dm_chief",
      botId: "chief",
      key: "answer-1",
      payload: { approved: true },
    };
    const first = await claimJob(USER, queued.id, continuation);
    expect(first).toMatchObject({
      claimed: true,
      job: { payload: { approved: true, continuationKey: "answer-1" } },
    });
    const replay = await claimJob(USER, queued.id, continuation);
    expect(replay?.claimed).toBe(false);
  });

  it("deletes a group's jobs and their events with the group", async () => {
    await mutateStore(USER, (store) => {
      store.threads.push({
        id: "group_1",
        kind: "group",
        title: "Group",
        botIds: ["chief", "research"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastPreview: "",
      });
    });
    const queued = await job("group-job", { threadId: "group_1" });
    await appendJobEvent(USER, queued.id, "x");
    expect(await deleteGroupThread(USER, "group_1")).toBe(true);
    expect(await getJob(USER, queued.id)).toBeNull();
    const count = await testDb.pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM run_job_events WHERE job_id = $1`,
      [queued.id],
    );
    expect(count.rows[0]?.n).toBe(0);
  });
});
