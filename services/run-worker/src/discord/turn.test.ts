import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import {
  configureRunForTest,
  createRunTestDb,
  resetRunTables,
  seedTestUser,
  type RunTestDb,
} from "@deniai/run/testing";

// The model, tools and computer are mocked: no OpenRouter, E2B or Steel. The store, the job
// queue, notifications and usage run for real on PGlite.
const calls = vi.hoisted(() => ({ prompts: [] as unknown[], tools: [] as string[] }));

vi.mock("@deniai/run/agent/llm", () => ({
  getDeniModel: async () => ({
    model: new MockLanguageModelV4({
      doStream: async (options) => {
        calls.prompts.push(options.prompt);
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "On it. Research is done." },
            { type: "text-end", id: "t" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 5, text: 5, reasoning: 0 },
              },
            },
          ]),
        };
      },
    }),
    providerOptions: {},
    modelId: "test/model",
  }),
  getSummaryModel: async () => {
    throw new Error("no summaries in this test");
  },
}));
vi.mock("@deniai/run/agent/index", () => ({
  buildInstructions: (bot: { id: string }) => {
    calls.tools.push(bot.id);
    return `You are ${bot.id}.`;
  },
  createDeniTools: () => ({}),
  deniToolApproval: () => undefined,
}));
vi.mock("@deniai/run/agent/compaction", () => ({
  compactThread: async ({ messages }: { messages: unknown[] }) => messages,
}));
vi.mock("@deniai/run/computer/index", () => ({ setComputer: async () => undefined }));
vi.mock("@deniai/run/computer/browser-workspaces", () => ({
  releaseBrowserTakeover: async () => undefined,
}));
vi.mock("@deniai/run/jobs/actions", () => ({ releaseStaleApproval: async () => false }));

const { runDiscordMessage } = await import("./turn");
const { listJobs } = await import("@deniai/run/jobs/index");
const { loadMessages, mutateStore, readStore } = await import("@deniai/run/data/store");
const { resetRateLimitsForTests } = await import("./rate-limit");

let testDb: RunTestDb;

beforeAll(async () => {
  testDb = await createRunTestDb();
  configureRunForTest(testDb, { config: { openrouterApiKey: "test-key" } });
}, 60_000);

afterAll(async () => {
  await testDb.pglite.close();
});

beforeEach(async () => {
  await resetRunTables(testDb.pglite);
  await seedTestUser(testDb.pglite, "alice");
  await readStore("alice");
  resetRateLimitsForTests();
  calls.prompts.length = 0;
  calls.tools.length = 0;
});

describe("runDiscordMessage", () => {
  it("routes a DM to the chosen teammate's thread and stores both sides", async () => {
    const outcome = await runDiscordMessage({
      userId: "alice",
      discordMessageId: "m1",
      text: "Compare the two vendors",
      botId: "research",
      locale: "en",
    });
    expect(outcome).toEqual({
      kind: "reply",
      botName: "Research",
      text: "On it. Research is done.",
    });
    expect(calls.tools).toEqual(["research"]);
    const [job] = await listJobs("alice", { threadId: "dm_research" });
    expect(job).toMatchObject({
      botId: "research",
      kind: "chat",
      status: "completed",
      idempotencyKey: "discord:m1",
    });
    expect(job?.payload).toMatchObject({ source: "discord" });
    const messages = await loadMessages("alice", "dm_research");
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0]?.id).toBe("discord_m1");
    expect(messages[1]?.metadata).toMatchObject({ author: { id: "research" }, jobId: job?.id });
  });

  it("falls back to the first teammate and ignores a redelivered Discord message", async () => {
    await runDiscordMessage({
      userId: "alice",
      discordMessageId: "m2",
      text: "Hello",
      botId: "deleted-teammate",
      locale: "en",
    });
    const again = await runDiscordMessage({
      userId: "alice",
      discordMessageId: "m2",
      text: "Hello",
      botId: "deleted-teammate",
      locale: "en",
    });
    expect(again).toEqual({ kind: "none" });
    expect(calls.prompts).toHaveLength(1);
    expect(await listJobs("alice", { threadId: "dm_chief" })).toHaveLength(1);
  });

  it("asks for a teammate when the account has none", async () => {
    await mutateStore("alice", (store) => {
      store.bots = [];
      store.threads = [];
    });
    const outcome = await runDiscordMessage({
      userId: "alice",
      discordMessageId: "m3",
      text: "Hello",
      botId: null,
      locale: "en",
    });
    expect(outcome.kind).toBe("notice");
    expect(calls.prompts).toHaveLength(0);
  });
});
