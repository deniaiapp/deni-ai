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
import { getJobByIdempotencyKey } from "../jobs";
import { handleChat } from "./route";

let testDb: RunTestDb;
const USER = "user-chat";

beforeAll(async () => {
  testDb = await createRunTestDb();
}, 60_000);

afterAll(async () => {
  await testDb.pglite.close();
});

beforeEach(async () => {
  await resetRunTables(testDb.pglite);
  configureRunForTest(testDb, {
    languageModel: () => mockTextModel("Hello from Chief.", { costUsd: 0.002 }),
    computer: { sandbox: null, browser: null },
  });
  await seedTestUser(testDb.pglite, USER);
  await readStore(USER);
});

function chatRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/run/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const input = (id: string, text: string) => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return read();
}

describe("handleChat", () => {
  it("streams the teammate's reply and persists both messages, with no computer configured", async () => {
    const response = await handleChat(
      chatRequest({ threadId: "dm_chief", idempotencyKey: "k1", messages: [input("m1", "Hi")] }),
      { userId: USER, locale: "en" },
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Hello from Chief.");
    expect(body).toContain("data-job-status");

    const job = await waitFor(
      () => getJobByIdempotencyKey(USER, "k1"),
      (value) => value?.status === "completed",
    );
    expect(job?.status).toBe("completed");
    const messages = await loadMessages(USER, "dm_chief");
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(messages[1]?.parts)).toContain("Hello from Chief.");
    expect((messages[1]?.metadata as { jobId?: string } | undefined)?.jobId).toBe(job?.id);

    const ledger = await testDb.pglite.query<{ used: string }>(
      `SELECT used::text FROM product_usage WHERE user_id = $1 AND product = 'run' AND metric = 'model'`,
      [USER],
    );
    expect(Number(ledger.rows[0]?.used)).toBe(2_000);
  });

  it("refuses a resubmitted message while its job exists (409)", async () => {
    const first = await handleChat(
      chatRequest({ threadId: "dm_chief", idempotencyKey: "same", messages: [input("m1", "Hi")] }),
      { userId: USER, locale: "en" },
    );
    await first.text();
    const again = await handleChat(
      chatRequest({ threadId: "dm_chief", idempotencyKey: "same", messages: [input("m1", "Hi")] }),
      { userId: USER, locale: "en" },
    );
    expect(again.status).toBe(409);
    expect(again.headers.get("X-Deni-Job-Status")).toBeTruthy();
  });

  it("answers 404 for a thread of another user", async () => {
    const response = await handleChat(
      chatRequest({ threadId: "dm_missing", messages: [input("m1", "Hi")] }),
      { userId: USER, locale: "en" },
    );
    expect(response.status).toBe(404);
  });

  it("answers 503 llm_unconfigured without an OpenRouter key", async () => {
    configureRunForTest(testDb, {
      config: { openrouterApiKey: null },
      computer: { sandbox: null, browser: null },
    });
    const response = await handleChat(
      chatRequest({ threadId: "dm_chief", messages: [input("m1", "Hi")] }),
      { userId: USER, locale: "ja" },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "llm_unconfigured" });
    expect(await loadMessages(USER, "dm_chief")).toEqual([]);
  });

  it("answers 402 with the usage-limit header once the pool is spent", async () => {
    await testDb.pglite.query(
      `INSERT INTO product_usage (user_id, product, metric, unit, period_start, used)
       VALUES ($1, 'run', 'model', 'usd_micros',
         date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 10000000)`,
      [USER],
    );
    const response = await handleChat(
      chatRequest({ threadId: "dm_chief", messages: [input("m1", "Hi")] }),
      { userId: USER, locale: "en" },
    );
    expect(response.status).toBe(402);
    expect(response.headers.get("x-usage-limit")).toBe("budget");
    expect(await response.json()).toMatchObject({ code: "usage_limit", metric: "budget" });
  });
});
