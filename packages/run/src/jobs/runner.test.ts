import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  configureRunForTest,
  createRunTestDb,
  mockTextModel,
  resetRunTables,
  seedTestUser,
  type RunTestDb,
} from "../testing";
import { loadMessages, readStore } from "../data/store";
import { cancelJob, createJob, getJob, listJobEvents } from "./index";
import { listNotifications } from "./notifications";
import { tick, waitForRunningJobs } from "./scheduler";
import { runBackgroundJob } from "./runner";

let testDb: RunTestDb;
const USER = "user-runner";

beforeAll(async () => {
  testDb = await createRunTestDb();
}, 60_000);

afterAll(async () => {
  await testDb.pglite.close();
});

beforeEach(async () => {
  await resetRunTables(testDb.pglite);
  configureRunForTest(testDb, {
    languageModel: () => mockTextModel("Report saved to /outbox/report.md.", { costUsd: 0.01 }),
    computer: { sandbox: null, browser: null },
  });
  await seedTestUser(testDb.pglite, USER);
  await readStore(USER);
});

const queue = (key: string) =>
  createJob({
    userId: USER,
    threadId: "dm_research",
    botId: "research",
    kind: "chat",
    idempotencyKey: key,
    payload: {
      locale: "en",
      messages: [
        { id: `${key}-input`, role: "user", parts: [{ type: "text", text: "Research X" }] },
      ],
    },
  });

async function runLedger() {
  const result = await testDb.pglite.query<{ metric: string; used: string }>(
    `SELECT metric, used::text FROM product_usage WHERE user_id = $1 AND product = 'run'`,
    [USER],
  );
  return result.rows.map((row) => ({ metric: row.metric, used: Number(row.used) }));
}

describe("background job runner", () => {
  it("runs a queued job from the scheduler tick to completion", async () => {
    const job = await queue("bg-1");
    await tick();
    await waitForRunningJobs();

    const done = await getJob(USER, job.id);
    expect(done?.error).toBeNull();
    expect(done?.status).toBe("completed");
    expect(done?.attempt).toBe(1);
    const messages = await loadMessages(USER, "dm_research");
    expect(messages.map((message) => message.id)).toEqual(["bg-1-input", `${job.id}_assistant`]);
    expect(JSON.stringify(messages.at(-1)?.parts)).toContain("Report saved");
    expect((messages.at(-1)?.metadata as { author?: { id: string } } | undefined)?.author?.id).toBe(
      "research",
    );
    // The model's reported cost is charged to the shared pool (micro-dollars).
    expect(await runLedger()).toEqual([{ metric: "model", used: 10_000 }]);
    const events = await listJobEvents(USER, job.id);
    expect(events.some((event) => event.kind === "checkpoint")).toBe(true);
    const notifications = await listNotifications(USER);
    expect(notifications[0]).toMatchObject({ kind: "completed", jobId: job.id });
    const store = await readStore(USER);
    expect(store.threads.find((thread) => thread.id === "dm_research")?.lastPreview).toContain(
      "Report saved",
    );
  });

  it("does not run a job twice (the second claim is refused)", async () => {
    const job = await queue("bg-2");
    const [first, second] = await Promise.all([
      runBackgroundJob(USER, job.id),
      runBackgroundJob(USER, job.id),
    ]);
    // The loser of the claim gets the job back without running it.
    expect([first?.status, second?.status]).toContain("completed");
    expect((await getJob(USER, job.id))?.attempt).toBe(1);
    const messages = await loadMessages(USER, "dm_research");
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(await runLedger()).toEqual([{ metric: "model", used: 10_000 }]);
  });

  it("stops at the next step when the job is cancelled mid-run", async () => {
    let jobId = "";
    configureRunForTest(testDb, {
      languageModel: () =>
        mockTextModel("Too late", {
          onCall: async () => {
            await cancelJob(USER, jobId);
          },
        }),
      computer: { sandbox: null, browser: null },
    });
    const job = await queue("bg-3");
    jobId = job.id;
    const result = await runBackgroundJob(USER, job.id);
    expect(result?.status).toBe("cancelled");
    const messages = await loadMessages(USER, "dm_research");
    expect(messages.some((message) => message.role === "assistant")).toBe(false);
    const notifications = await listNotifications(USER);
    expect(notifications.some((item) => item.kind === "completed")).toBe(false);
  });

  it("fails with a setup notification when no language model is configured", async () => {
    configureRunForTest(testDb, {
      config: { openrouterApiKey: null },
      computer: { sandbox: null, browser: null },
    });
    const job = await queue("bg-4");
    const result = await runBackgroundJob(USER, job.id);
    expect(result?.status).toBe("failed");
    const notifications = await listNotifications(USER);
    expect(notifications[0]).toMatchObject({ kind: "failed", title: "Task needs setup" });
  });
});
