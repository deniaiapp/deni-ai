import type { UIMessage } from "ai";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  activeGenerationId: null as string | null,
  mode: "stopped" as "stopped" | "replaced" | "finished",
  output: true,
  guest: false,
  usage: true,
  consumed: 0,
  refunded: 0,
  reported: 0,
  settled: 0,
  inputTokens: 10,
  limitReached: false,
  failSettlement: false,
  nextStep: false,
  memory: false,
}));
const stepMessages = [
  { role: "tool", content: [{ type: "tool-result", toolCallId: "call", output: "Result" }] },
];
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({ session: { userId: "user" }, user: { isAnonymous: state.guest } }),
    },
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (task: () => unknown) => void task() };
});
vi.mock("@/lib/chat", () => ({
  getChatById: async () => ({ id: "chat", title: "Existing", messages: [], projectId: null }),
  getChatGenerationContextById: async () => ({ id: "chat", title: "Existing", projectId: null }),
  updateChat: vi.fn(async (_id, _user, _messages, _title, options) => {
    state.activeGenerationId = options.nextGenerationId ?? state.activeGenerationId;
  }),
  isChatGenerationActive: async (_id: string, _user: string, generation: string) =>
    state.activeGenerationId === generation,
  // Mirrors the guarded stop: clears and returns the generation that was active.
  stopActiveChatGeneration: async () => {
    const stopped = state.activeGenerationId;
    state.activeGenerationId = null;
    return stopped;
  },
  replaceLastChatMessage: vi.fn(),
  clearChatGenerationState: vi.fn(async () => {
    state.activeGenerationId = null;
    return "chat";
  }),
  generateTitle: vi.fn(),
}));
vi.mock("@/lib/memory", () => ({
  getUserMemoryState: async () => ({ profile: { autoMemory: state.memory } }),
  buildMemoryPrompt: () => null,
  maybeAutoSaveMemories: vi.fn(async () => {}),
}));
vi.mock("@/lib/project-context", () => ({ buildProjectPrompt: async () => null }));
vi.mock("@/lib/chat-tools", () => ({ createChatTools: () => ({}) }));
vi.mock("@/lib/platform-capabilities.server", () => ({
  platformCapabilities: {
    features: {
      get memory() {
        return state.memory;
      },
      webSearch: false,
    },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/usage", async () => {
  class UsageLimitError extends Error {}
  return {
    UsageLimitError,
    consumeUsage: vi.fn(
      async ({ amount, reservationId }: { amount: number; reservationId: string }) => {
        state.consumed += amount;
        return { reservationId, maxModeAmount: 0 };
      },
    ),
    recordObservedUsage: vi.fn(async () => {}),
    settleUsage: vi.fn(async ({ amount }: { amount: number }) => {
      if (state.failSettlement) throw new Error("Quota write failed");
      state.refunded += state.consumed - amount;
      state.settled++;
      state.reported += state.guest ? 0 : amount;
      return { amount, maxModeAmount: state.guest ? 0 : amount };
    }),
  };
});
vi.mock("@/app/api/chat/_lib/model", async () => {
  class ChatRouteError extends Error {}
  return {
    ChatRouteError,
    addOpenRouterCacheControl: vi.fn(),
    resolveChatModelContext: async () => ({
      model: {},
      providerOptions: {},
      usageCategory: "basic",
      usageUnit: state.guest ? "requests" : "tokens",
      usesOpenRouter: false,
    }),
  };
});
vi.mock("@/lib/constants", async () => {
  const actual = await vi.importActual<typeof import("@/lib/constants")>("@/lib/constants");
  return { ...actual, getEffectiveTokenMultiplier: () => 1 };
});
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: vi.fn((options) => ({
      toUIMessageStream: () =>
        new ReadableStream({
          async start(controller) {
            const streamStep = async () => {
              await options.onStepStart();
              if (state.output)
                await options.onChunk({
                  chunk: { type: "text-delta", id: "text", text: "Partial answer" },
                });
            };
            await streamStep();
            if (state.usage)
              await options.onStepFinish({
                usage: { inputTokens: state.inputTokens, outputTokens: 2 },
                response: { messages: stepMessages },
              });
            if (state.nextStep) await streamStep();
            if (state.mode === "stopped") {
              const { POST } = await import("@/app/api/chat/stop/route");
              await POST(
                new Request("http://localhost/api/chat/stop", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ id: "chat" }),
                }),
              );
            } else if (state.mode === "replaced") {
              const { startChatGeneration } = await import("@/lib/chat-generation");
              startChatGeneration("chat", "new-generation");
              state.activeGenerationId = "new-generation";
            } else if (state.usage) {
              await options.onFinish({
                totalUsage: { inputTokens: state.inputTokens, outputTokens: 2 },
              });
            }
            if (state.output) {
              controller.enqueue({ type: "text-start", id: "text" });
              controller.enqueue({ type: "text-delta", id: "text", delta: "Partial answer" });
              controller.enqueue({ type: "text-end", id: "text" });
            }
            controller.enqueue({ type: state.mode === "finished" ? "finish" : "abort" });
            controller.close();
          },
        }),
    })),
  };
});

const { POST } = await import("../src/app/api/chat/route");
const { streamText } = await import("ai");
const { clearChatGenerationState, replaceLastChatMessage, updateChat } = await import("@/lib/chat");
const { maybeAutoSaveMemories } = await import("@/lib/memory");
const { GUEST_MAX_OUTPUT_TOKENS, GUEST_MAX_PROMPT_TOKENS } =
  await import("../src/app/api/chat/_lib/usage-estimate");
const { clearChatGeneration, isCurrentChatGeneration } = await import("@/lib/chat-generation");

beforeEach(() => {
  vi.clearAllMocks();
  state.activeGenerationId = null;
  state.mode = "stopped";
  state.output = true;
  state.guest = false;
  state.usage = true;
  state.consumed = 0;
  state.refunded = 0;
  state.reported = 0;
  state.settled = 0;
  state.inputTokens = 10;
  state.limitReached = false;
  state.failSettlement = false;
  state.nextStep = false;
  state.memory = false;
});

function chatRequest(text = "Hello") {
  const messages: UIMessage[] = [
    { id: "user-message", role: "user", parts: [{ type: "text", text }] },
  ];
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "chat", model: "gpt-5.6-luna", messages }),
  });
}

async function run() {
  const response = await POST(chatRequest());
  expect(response.status).toBe(200);
  await response.text();
}

// Reservation = prompt estimate + 1,024 output buffer (multiplier mocked to 1).
const promptEstimate = () => state.consumed - 1_024;
// "Partial answer" is 14 chars ≈ 4 output tokens, weighted 5×.
const streamedOutputAmount = 20;

test("cross-site chat requests cannot consume usage", async () => {
  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}",
    }),
  );
  expect(response.status).toBe(403);
  expect(state.consumed).toBe(0);
});

test("an oversized chat request cannot consume usage", async () => {
  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(17 * 1024 * 1024) },
      body: "{}",
    }),
  );
  expect(response.status).toBe(413);
  expect(state.consumed).toBe(0);
});

test.each(["stopped", "replaced"] as const)(
  "%s generations reconcile usage without writing a stale transcript",
  async (mode) => {
    state.mode = mode;
    await run();
    expect(state.consumed).toBeGreaterThan(20);
    expect(state.consumed - state.refunded).toBe(20);
    expect(state.reported).toBe(20);
    expect(state.settled).toBe(1);
    expect(clearChatGenerationState).not.toHaveBeenCalled();
    expect(replaceLastChatMessage).not.toHaveBeenCalled();
    if (mode === "replaced") {
      expect(isCurrentChatGeneration("chat", "new-generation")).toBe(true);
      clearChatGeneration("chat", "new-generation");
    }
  },
);

test("stopping before any output refunds the entire reservation", async () => {
  state.output = false;
  state.usage = false;
  await run();
  expect(state.refunded).toBe(state.consumed);
  expect(state.reported).toBe(0);
});

test("aborted output with no provider usage still bills the unfinished step", async () => {
  state.usage = false;
  await run();
  const retained = promptEstimate() + streamedOutputAmount;
  expect(retained).toBeGreaterThan(1);
  expect(state.consumed - state.refunded).toBe(retained);
  expect(state.reported).toBe(retained);
});

test.each(["stopped", "replaced"] as const)(
  "a %s tool-loop step bills its prompt on top of the finished steps",
  async (mode) => {
    state.mode = mode;
    state.nextStep = true;
    await run();
    const stepMessageTokens = Math.ceil(JSON.stringify(stepMessages).length / 4);
    const retained = 20 + promptEstimate() + stepMessageTokens + streamedOutputAmount;
    expect(state.consumed - state.refunded).toBe(retained);
    expect(state.reported).toBe(retained);
    if (mode === "replaced") clearChatGeneration("chat", "new-generation");
  },
);

test("normal completion settles once and finalizes the owned transcript", async () => {
  state.mode = "finished";
  await run();
  expect(state.consumed - state.refunded).toBe(20);
  expect(state.reported).toBe(20);
  expect(state.settled).toBe(1);
  expect(clearChatGenerationState).toHaveBeenCalledOnce();
});

test("a guest stop before output refunds the request unit", async () => {
  state.guest = true;
  state.output = false;
  state.usage = false;
  await run();
  expect(state.consumed).toBe(1);
  expect(state.refunded).toBe(1);
  expect(state.reported).toBe(0);
});

test("usage above the reservation is billed even past the plan limit", async () => {
  state.mode = "finished";
  state.inputTokens = 500_000;
  state.limitReached = true;
  await run();
  expect(state.consumed - state.refunded).toBe(500_010);
  expect(state.reported).toBe(500_010);
  expect(clearChatGenerationState).toHaveBeenCalledOnce();
});

test("a failed settlement keeps the streamed answer in the transcript", async () => {
  state.mode = "finished";
  state.inputTokens = 500_000;
  state.failSettlement = true;
  await run();
  expect(clearChatGenerationState).toHaveBeenCalledOnce();
});

test("guests cannot send oversized prompts for one request unit", async () => {
  state.guest = true;
  const response = await POST(chatRequest("x".repeat(4 * GUEST_MAX_PROMPT_TOKENS)));
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ reason: "guest_prompt_too_long" });
  expect(state.consumed).toBe(0);
  expect(streamText).not.toHaveBeenCalled();
  expect(updateChat).not.toHaveBeenCalled();
});

test("guest output is capped and skips unbilled memory extraction", async () => {
  state.mode = "finished";
  state.memory = true;
  state.guest = true;
  await run();
  expect(streamText).toHaveBeenLastCalledWith(
    expect.objectContaining({ maxOutputTokens: GUEST_MAX_OUTPUT_TOKENS }),
  );
  expect(maybeAutoSaveMemories).not.toHaveBeenCalled();

  state.guest = false;
  state.activeGenerationId = null;
  await run();
  expect(streamText).toHaveBeenLastCalledWith(
    expect.objectContaining({ maxOutputTokens: undefined }),
  );
  expect(maybeAutoSaveMemories).toHaveBeenCalledOnce();
});
