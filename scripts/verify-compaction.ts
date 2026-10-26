import dotenv from "dotenv";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { UIMessage } from "ai";
import { mockModules } from "./module-mocks";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });

mockModules((request) => (request === "@tanstack/react-start/server-only" ? {} : undefined));

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

let tempDir = "";

// Compaction: a long conversation is summarized once, the summary replaces the older turns for
// the model, tool results reach the summary, and teammates replying at once share one summary.
async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-compaction-"));
  delete process.env.D1_PROXY_URL;
  process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  process.env.APP_ENCRYPTION_KEY ||= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.DENI_AI_URL = "https://deni.test";
  process.env.DENI_RUN_SERVICE_SECRET = "test-service-secret";

  const { db } = await import("../db");
  const { account, user } = await import("../db/schema");
  const store = await import("../lib/store");
  const { compactThread } = await import("../lib/compaction");
  const { SUMMARY_MODEL_ID } = await import("../lib/model");
  const { COMPACT_TOKEN_LIMIT, isCompaction, messagesForModel } = await import("../lib/messages");

  const calls: { model: string; body: string }[] = [];
  const replies: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith("https://deni.test/api/integrations/deni-run/usage")) {
      return Response.json({ tier: "free", periodEnd: "2026-11-01T00:00:00.000Z", limitUsd: 10, usedUsd: 0.01, remainingUsd: 9.99, breakdownUsd: { model: 0.01, browser: 0, computer: 0 }, manageUrl: "https://deni.test/settings/billing" });
    }
    if (!String(input).includes("/chat/completions")) return realFetch(input, init);
    const body = String(init?.body ?? "");
    calls.push({ model: JSON.parse(body).model, body });
    // Let parallel callers pile up before answering, as a real request would.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const content = replies.shift();
    if (content === undefined) return new Response("unavailable", { status: 503 });
    return Response.json({
      id: "gen-1",
      object: "chat.completion",
      created: 0,
      model: SUMMARY_MODEL_ID,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1_000, completion_tokens: 200, total_tokens: 1_200, cost: 0.0042 },
    });
  }) as typeof fetch;

  const userId = "c1";
  await db.insert(user).values({ id: userId, name: userId, email: "c1@example.com", emailVerified: true });
  await db.insert(account).values({ id: "acc-c1", accountId: "deni-c1", providerId: "deni-ai", userId });
  const initial = await store.readStore(userId);
  const thread = initial.threads.find((item) => item.kind === "dm" && item.botIds[0] === "ops");
  assert(Boolean(thread), "seeded ops DM missing");
  const threadId = thread!.id;
  const bot = initial.bots.find((item) => item.id === "ops")!;
  const load = () => store.loadMessages(userId, threadId);
  const compact = (messages: UIMessage[]) => compactThread({ userId, threadId, bot, messages });

  // Each turn is 1/20 of the limit, so 30 turns call for a compaction.
  const pad = "x".repeat(Math.ceil(COMPACT_TOKEN_LIMIT / 40) * 4);
  const turn = (index: number): UIMessage[] => [
    { id: `u${index}`, role: "user", parts: [{ type: "text", text: `request ${index} ${pad}` }] },
    {
      id: `a${index}`,
      role: "assistant",
      parts: [
        ...(index === 1
          ? [{ type: "tool-mcp", toolCallId: "subs", state: "output-available", input: { name: "list_subscriptions" }, output: { content: [{ type: "text", text: "sub_0 … sub_9, 10 active" }] } }]
          : []),
        { type: "text", text: `done ${index} ${pad}` },
      ],
    } as UIMessage,
  ];
  const turns = (from: number, to: number) => Array.from({ length: to - from }, (_, offset) => turn(from + offset)).flat();
  const ask = (id: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text: `question ${id}` }] });

  // A short conversation is left alone, without a model call.
  await store.saveMessages(userId, threadId, [...turns(1, 3), ask("q0")]);
  assert((await compact(await load())).length === (await load()).length && calls.length === 0, "short conversation compacted");

  // A long one is summarized with the cheap model in requests of bounded size, oldest first, each
  // extending the summary so far. Tool results are included; the newest turns are left out.
  await store.saveMessages(userId, threadId, [...turns(3, 31), ask("q1")]);
  replies.push("- Ten active subscriptions (sub_0 to sub_9).", "- Ten active subscriptions (sub_0 to sub_9).\n- Requests up to 25.");
  const compacted = await compact(await load());
  assert(calls.length === 2 && calls.every((call) => call.model === SUMMARY_MODEL_ID), `summary calls: ${calls.map((call) => call.model)}`);
  assert(calls[0].body.includes("10 active") && calls[0].body.includes("request 1 "), "the oldest turns and their tool results must be summarized");
  assert(calls[1].body.includes("Summary so far") && calls[1].body.includes("Ten active subscriptions"), "later requests must extend the summary so far");
  assert(!calls.some((call) => call.body.includes("question q1")), "the newest turn must not be summarized");
  const stored = await load();
  assert(isCompaction(stored.at(-1)!) && compacted.at(-1)?.id === stored.at(-1)?.id, "the compaction marker was not saved");

  // The model sees the final summary, the recent turns, and the new question; not the summarized turns.
  const view = JSON.stringify(messagesForModel(stored));
  assert(view.includes("Requests up to 25") && view.includes("question q1") && !view.includes("request 1 "), "model view after compaction");

  // Asking again right away does not summarize again.
  await compact(stored);
  assert(calls.length === 2, "compacted again without new messages");

  // A resumed turn (the last message is the reply) is never compacted.
  await store.saveMessages(userId, threadId, [...turns(31, 45)]);
  await compact(await load());
  assert(calls.length === 2, "a resumed turn was compacted");

  // Teammates replying at once share one compaction, which extends the one before.
  await store.saveMessages(userId, threadId, [ask("q2")]);
  replies.push("- Ten active subscriptions (sub_0 to sub_9).\n- Later requests up to 44.");
  const current = await load();
  const [first, second] = await Promise.all([compact(current), compact(current)]);
  assert(calls.length === 3 && first.at(-1)?.id === second.at(-1)?.id, `parallel compactions were not shared: ${calls.length} calls`);
  assert(calls[2].body.includes("Summary so far") && calls[2].body.includes("Requests up to 25") && !calls[2].body.includes("request 1 "), "a new compaction must extend the last summary");
  assert((await load()).filter(isCompaction).length === 2, "expected one marker per compaction");

  // A very long history is summarized in at most three requests; older messages are left out.
  await store.saveMessages(userId, threadId, [...turns(45, 130), ask("q3")]);
  replies.push("- part 1", "- part 2", "- part 3");
  await compact(await load());
  assert(calls.length === 6 && calls[3].body.includes("too long to include"), `long history: ${calls.length} calls`);

  // If summarizing fails, the thread is returned unchanged and nothing is saved.
  await store.saveMessages(userId, threadId, [...turns(130, 150), ask("q4")]);
  const before = await load();
  const logError = console.error;
  console.error = () => undefined;
  const failed = await compact(before);
  console.error = logError;
  assert(calls.length > 6 && failed.length === before.length && (await load()).length === before.length, "a failed compaction changed the thread");

  assert(replies.length === 0, "unused scripted summaries");
  globalThis.fetch = realFetch;
  console.log("compaction verification passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    process.exit();
  });
