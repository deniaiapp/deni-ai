import { afterAll, beforeAll, it } from "vitest";
import { configureRunForTest, createRunTestDb, seedTestUser, type RunTestDb } from "../src/testing";
import type { UIMessage } from "ai";
import type { HistoryRequest } from "../src/agent/history";

let testDb: RunTestDb;

beforeAll(async () => {
  testDb = await createRunTestDb();
  configureRunForTest(testDb, { config: { openrouterApiKey: "test-key" } });
}, 60_000);

afterAll(async () => {
  await testDb.pglite.close();
});

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// conversationHistory: the model can summarize, search, and open the part of a thread it no
// longer receives, and the summary is built once and then only extended with new messages.
it("conversationHistory summarizes, searches and opens hidden history", async () => {
  // Usage is reported to Deni AI; the fetch mock below answers for it.

  const store = await import("../src/data/store");
  const { lookBack } = await import("../src/agent/history");
  const { clearThread, resetThreadContext } = await import("../src/agent/thread-context");
  const { createDeniTools } = await import("../src/agent");
  const { SUMMARY_MODEL_ID } = await import("../src/agent/model");
  const { HISTORY_TOKEN_LIMIT } = await import("../src/chat/messages");

  const calls: { model: string; body: string }[] = [];
  const replies: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).includes("/chat/completions")) return realFetch(input, init);
    const body = String(init?.body ?? "");
    calls.push({ model: JSON.parse(body).model, body });
    const content = replies.shift();
    if (content === undefined) throw new Error("summary model called more often than expected");
    return Response.json({
      id: "gen-1",
      object: "chat.completion",
      created: 0,
      model: SUMMARY_MODEL_ID,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1_000, completion_tokens: 200, total_tokens: 1_200, cost: 0.0042 },
    });
  }) as typeof fetch;

  const userId = "h1";
  await seedTestUser(testDb.pglite, userId);
  const initial = await store.readStore(userId);
  const thread = initial.threads.find((item) => item.kind === "dm" && item.botIds[0] === "ops");
  assert(Boolean(thread), "seeded ops DM missing");
  const threadId = thread!.id;
  const bot = initial.bots.find((item) => item.id === "ops")!;
  const ask = (request: HistoryRequest) =>
    lookBack({ userId, threadId, bot, ...request }) as Promise<Record<string, unknown>>;

  assert(
    "conversationHistory" in createDeniTools({ userId, bot, threadId }),
    "tool not registered",
  );

  // Nothing is hidden yet: no model call.
  await store.saveMessages(userId, threadId, [
    { id: "hello", role: "user", parts: [{ type: "text", text: "hello" }] },
  ]);
  const empty = await ask({ action: "summary" });
  assert(empty.summary === null && calls.length === 0, `empty summary: ${JSON.stringify(empty)}`);

  // Each turn is 1/15 of the budget, so 30 turns push the early ones out of the window.
  const pad = "x".repeat(Math.ceil(HISTORY_TOKEN_LIMIT / 30) * 4);
  const turn = (index: number, note = ""): UIMessage[] => [
    {
      id: `u${index}`,
      role: "user",
      parts: [{ type: "text", text: `request ${index} ${note} ${pad}` }],
    },
    { id: `a${index}`, role: "assistant", parts: [{ type: "text", text: `done ${index} ${pad}` }] },
  ];
  const turns = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, offset) =>
      turn(
        from + offset,
        from + offset === 1
          ? "the invoice number is INV-4471"
          : from + offset === 29
            ? "latest topic ZEBRA"
            : "",
      ),
    ).flat();
  await store.saveMessages(userId, threadId, turns(1, 30));

  // Search finds hidden messages only; read opens one in full.
  const found = await ask({ action: "search", query: "inv-4471" });
  const results = found.results as { messageId: string; excerpt: string }[];
  assert(
    results.length === 1 &&
      results[0].messageId === "u1" &&
      results[0].excerpt.includes("INV-4471"),
    `search: ${JSON.stringify(found)}`,
  );
  const visible = await ask({ action: "search", query: "ZEBRA" });
  assert(
    (visible.results as unknown[]).length === 0,
    "search returned a message the model already sees",
  );
  const opened = await ask({ action: "read", messageId: "u1" });
  assert(
    String(opened.text).includes("INV-4471") && opened.from === "Person",
    `read: ${JSON.stringify(opened).slice(0, 200)}`,
  );
  assert(
    typeof (await ask({ action: "read", messageId: "nope" })).error === "string",
    "unknown message opened",
  );
  assert(typeof (await ask({ action: "search" })).error === "string", "search without a query");

  // The first summary covers the hidden part, uses the cheap model, and its cost is reported to Deni AI.
  replies.push("- Invoice INV-4471 was discussed.");
  const first = await ask({ action: "summary" });
  assert(
    first.summary === "- Invoice INV-4471 was discussed." && calls.length === 1,
    `first summary: ${JSON.stringify(first)}`,
  );
  assert(calls[0].model === SUMMARY_MODEL_ID, `summary model: ${calls[0].model}`);
  assert(
    calls[0].body.includes("INV-4471") && !calls[0].body.includes("ZEBRA"),
    "summary input must be the hidden part only",
  );
  const ledger = await testDb.pglite.query<{ metric: string; used: string }>(
    `SELECT metric, used::text FROM product_usage WHERE user_id = $1 AND product = 'run'`,
    [userId],
  );
  assert(
    ledger.rows.length === 1 &&
      ledger.rows[0]!.metric === "model" &&
      Number(ledger.rows[0]!.used) === 4_200,
    `ledger ${JSON.stringify(ledger.rows)}`,
  );

  // Asking again reuses the stored summary.
  const again = await ask({ action: "summary" });
  assert(
    again.summary === first.summary && calls.length === 1,
    "summary was rebuilt without new hidden messages",
  );

  // After more turns push more out, only the newly hidden messages are sent, with the summary so far.
  await store.saveMessages(userId, threadId, turns(30, 45));
  replies.push("- Invoice INV-4471 was discussed.\n- More requests followed.");
  const extended = await ask({ action: "summary" });
  assert(
    calls.length === 2 && String(extended.summary).includes("More requests"),
    `extended: ${JSON.stringify(extended)}`,
  );
  assert(
    calls[1].body.includes("Summary so far") &&
      calls[1].body.includes("Invoice INV-4471 was discussed") &&
      !calls[1].body.includes("request 1 the invoice"),
    "summary was not extended incrementally",
  );

  // A reset hides the rest of the thread; it is folded into the same summary.
  assert((await resetThreadContext(userId, threadId)) === "reset", "reset refused");
  replies.push("- Everything up to the reset.");
  await ask({ action: "summary" });
  assert(
    calls.length === 3 && calls[2].body.includes("request 44"),
    "messages before the reset were not summarized",
  );
  assert(
    ((await ask({ action: "search", query: "zebra" })) as { results: unknown[] }).results.length ===
      1,
    "pre-reset messages not searchable",
  );

  // A summary for a conversation that no longer exists is dropped.
  await store.mutateStore(userId, (next) => {
    next.historySummaries = {
      ...next.historySummaries,
      gone: { throughMessageId: "x", text: "old", updatedAt: "" },
    };
  });
  const pruned = await store.readStore(userId);
  assert(
    !pruned.historySummaries?.gone && Boolean(pruned.historySummaries?.[threadId]),
    "summaries were not pruned to live threads",
  );

  // Clearing deletes the conversation itself: messages, reactions, and the look-back summary.
  await store.mutateStore(userId, (next) => {
    const thread = next.threads.find((item) => item.id === threadId);
    if (thread) thread.reactions = { "id:x": ["👍"] };
  });
  assert((await clearThread(userId, threadId)) === "reset", "clear refused");
  assert((await store.loadMessages(userId, threadId)).length === 0, "messages survived a clear");
  const cleared = await store.readStore(userId);
  const clearedThread = cleared.threads.find((item) => item.id === threadId);
  assert(
    Boolean(clearedThread) &&
      Object.keys(clearedThread?.reactions ?? {}).length === 0 &&
      !clearedThread?.lastPreview,
    "reactions or preview survived a clear",
  );
  assert(!cleared.historySummaries?.[threadId], "the look-back summary survived a clear");
  assert(
    ((await ask({ action: "search", query: "zebra" })) as { results: unknown[] }).results.length ===
      0,
    "cleared messages are still searchable",
  );
  assert(
    (await clearThread(userId, "missing-thread")) === "missing",
    "clearing a missing thread should say so",
  );
  await store.saveMessages(userId, threadId, [
    { id: "after-clear", role: "user", parts: [{ type: "text", text: "a fresh start" }] },
  ]);
  assert(
    (await store.loadMessages(userId, threadId)).length === 1,
    "the cleared conversation could not be used again",
  );

  assert(replies.length === 0, "unused scripted summaries");
  globalThis.fetch = realFetch;
}, 120_000);
