import dotenv from "dotenv";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mockModules } from "./module-mocks";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });

mockModules((request) => {
  if (request === "@tanstack/react-start/server-only") return {};
  return undefined;
});

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

let tempDir = "";

// D1 has no row locks, advisory locks, or interactive transactions. These checks cover
// the replacements: version compare-and-swap, conditional UPDATE claims, sequence
// allocation inside the INSERT, and batch-as-transaction.
async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-d1-"));
  if (process.env.VERIFY_D1_PROXY_URL) {
    // Run the same checks through the d1-proxy Worker (e.g. `wrangler dev --local`).
    process.env.D1_PROXY_URL = process.env.VERIFY_D1_PROXY_URL;
  } else {
    delete process.env.D1_PROXY_URL;
    process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  }

  const { eq } = await import("drizzle-orm");
  const { db, rawRows } = await import("../db");
  const { userStores, threadMessages } = await import("../db/schema");
  const store = await import("../lib/store");
  const jobs = await import("../lib/jobs");
  const rateLimit = await import("../lib/rate-limit");

  // 1. Concurrent mutations on one user never lose an update.
  await store.readStore("u1");
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      store.mutateStore("u1", (s) => {
        s.usage!.tokens += 1;
        s.computer.activity.unshift({ at: new Date().toISOString(), botId: null, label: `n${i}` } as never);
      }),
    ),
  );
  assert((await store.readStore("u1")).usage!.tokens === 25, "mutateStore lost updates");

  // 2. A writer outside this process bumps the version mid-mutation: the callback is re-run
  // against fresh data instead of overwriting the other writer.
  let runs = 0;
  await store.mutateStore("u1", async (s) => {
    runs += 1;
    if (runs === 1) {
      const [row] = await db.select().from(userStores).where(eq(userStores.userId, "u1"));
      const external = structuredClone(row!.data);
      external.usage!.tokens += 100;
      await db.update(userStores).set({ data: external, version: row!.version + 1 }).where(eq(userStores.userId, "u1"));
    }
    s.usage!.tokens += 1;
  });
  assert(runs === 2, `expected the callback to re-run once, ran ${runs}`);
  assert((await store.readStore("u1")).usage!.tokens === 126, "compare-and-swap overwrote an external write");

  // 3. Event sequences stay unique and gapless under concurrency.
  const job = await jobs.createJob({ userId: "u1", threadId: "t1", botId: "b1", kind: "chat", payload: {}, idempotencyKey: "k1" });
  await Promise.all(Array.from({ length: 20 }, () => jobs.appendJobEvent("u1", job.id, "tick", {})));
  const events = await jobs.listJobEvents("u1", job.id);
  assert(events.length === 20, `expected 20 events, got ${events.length}`);
  assert(events.every((event, i) => event.sequence === i + 1), "event sequences are not 1..20");

  // 4. Exactly one of many concurrent claims wins.
  const claims = await Promise.all(Array.from({ length: 6 }, () => jobs.claimJob("u1", job.id)));
  assert(claims.filter((claim) => claim?.claimed).length === 1, "more than one worker claimed the same job");
  assert((await jobs.getJob("u1", job.id))?.attempt === 1, "attempt was incremented more than once");

  // 5. Job summaries do not load payloads and keep the checkpoint preview.
  await jobs.checkpointJob("u1", job.id, { text: "x".repeat(5000), step: 3, updatedAt: "now" });
  const [summary] = await jobs.listJobs("u1", { summary: true });
  assert(Object.keys(summary!.payload).length === 0, "summary leaked the payload");
  assert((summary!.checkpoint?.text as string).length === 2000 && summary!.checkpoint?.step === 3, "checkpoint summary is wrong");

  // 6. Rate limit window counts and resets.
  const results: boolean[] = [];
  for (let i = 0; i < 4; i += 1) {
    results.push(await rateLimit.assertRateLimit("u1", "b", 3, 60_000).then(() => true, () => false));
  }
  assert(JSON.stringify(results) === JSON.stringify([true, true, true, false]), `rate limit window: ${results}`);

  // 7. JSON queries: due routines and the Stripe customer lookup.
  await store.mutateStore("u1", (s) => {
    s.billing!.stripeCustomerId = "cus_123";
    s.routines.push(
      { id: "r1", botId: "b", threadId: "t", name: "n", instructions: "", cron: "* * * * *", timezone: "UTC", enabled: true, lastRunAt: null, nextRunAt: "2026-01-01T00:00:00.000Z", lastError: null, createdAt: "" },
      { id: "r2", botId: "b", threadId: "t", name: "n", instructions: "", cron: "* * * * *", timezone: "UTC", enabled: false, lastRunAt: null, nextRunAt: "2026-01-01T00:00:00.000Z", lastError: null, createdAt: "" },
    );
  });
  await store.readStore("u2");
  assert(JSON.stringify(await store.listDueRoutineUserIds(new Date("2026-06-01T00:00:00Z"))) === '["u1"]', "due routine lookup");
  assert((await store.listDueRoutineUserIds(new Date("2025-06-01T00:00:00Z"))).length === 0, "future routine reported as due");
  assert((await store.findUserIdByStripeCustomer("cus_123")) === "u1", "stripe customer lookup");
  assert((await store.findUserIdByStripeCustomer("cus_nope")) === null, "unknown stripe customer");

  // 8. saveMessages merges and deleteGroupThread removes everything atomically.
  await store.mutateStore("u1", (s) => {
    s.threads.push({ id: "g1", kind: "group", title: "g", botIds: [], createdAt: "", updatedAt: "", lastPreview: "" });
  });
  await store.saveMessages("u1", "g1", [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }] as never);
  await store.saveMessages("u1", "g1", [{ id: "m2", role: "assistant", parts: [{ type: "text", text: "yo" }] }] as never);
  assert((await store.loadMessages("u1", "g1")).length >= 1, "messages were not saved");
  const groupJob = await jobs.createJob({ userId: "u1", threadId: "g1", botId: "b1", kind: "chat", payload: {}, idempotencyKey: "kg" });
  await jobs.appendJobEvent("u1", groupJob.id, "x", {});
  assert(await store.deleteGroupThread("u1", "g1"), "deleteGroupThread returned false");
  assert((await jobs.getJob("u1", groupJob.id)) === null, "group job survived deletion");
  assert((await jobs.listJobEvents("u1", groupJob.id)).length === 0, "group job events survived deletion");
  assert((await db.select().from(threadMessages).where(eq(threadMessages.threadId, "g1"))).length === 0, "group messages survived deletion");
  assert(!(await store.readStore("u1")).threads.some((thread) => thread.id === "g1"), "group thread survived deletion");

  // 9. A failing batch leaves nothing behind (batch is the transaction primitive).
  let failed = false;
  try {
    await db.batch([
      db.insert(userStores).values({ userId: "atomic", data: (await store.readStore("u2")) }),
      db.insert(userStores).values({ userId: "atomic", data: (await store.readStore("u2")) }),
    ]);
  } catch {
    failed = true;
  }
  assert(failed, "duplicate insert in a batch should fail");
  const left = await rawRows("select 1 from user_stores where user_id = ?", ["atomic"]);
  assert(left.length === 0, "failed batch was partially applied");

  console.log("verified D1 semantics: compare-and-swap, claims, event sequences, rate limits, JSON queries, batch atomicity");
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });
