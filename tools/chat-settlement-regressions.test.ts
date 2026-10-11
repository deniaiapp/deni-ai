import type { UIMessage } from "ai";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  activeGenerationId: null as string | null,
  // The latest stop recorded on the chat row, by any instance.
  stopRequestedAt: null as Date | null,
  mode: "stopped" as "stopped" | "replaced" | "finished",
  output: true,
  guest: false,
  usage: true,
  consumed: 0,
  refunded: 0,
  reported: 0,
  settled: 0,
  inputTokens: 10,
  cacheReadTokens: undefined as number | undefined,
  limitReached: false,
  failSettlement: false,
  // The first call ended (its usage was reported) even when its step did not finish.
  callEnded: false,
  nextStep: false,
  // The next step's provider call is rejected before its stream starts.
  nextStepRejected: false,
  // The next step's provider call is accepted but streams nothing before the stop.
  nextStepSilent: false,
  upstreamError: false,
  memory: false,
  storedMessages: [] as UIMessage[],
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
  getChatById: async () => ({
    id: "chat",
    title: "Existing",
    messages: state.storedMessages,
    projectId: null,
  }),
  getChatGenerationContextById: async () => ({ id: "chat", title: "Existing", projectId: null }),
  updateChat: vi.fn(async (_id, _user, _messages, _title, options) => {
    state.activeGenerationId = options?.nextGenerationId ?? state.activeGenerationId;
    return { id: "chat", stopRequestedAt: state.stopRequestedAt };
  }),
  recordChatStopRequestedAt: vi.fn(async (_id: string, _user: string, requestedAt: Date) => {
    if (!state.stopRequestedAt || state.stopRequestedAt.getTime() < requestedAt.getTime()) {
      state.stopRequestedAt = requestedAt;
    }
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
  restoreStoppedRegeneration: vi.fn(async () => true),
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
// Attachments are referenced by URL only; nothing is downloaded in these tests.
vi.mock("@/lib/chat-attachment-download", async () => {
  const actual = await vi.importActual<typeof import("@/lib/chat-attachment-download")>(
    "@/lib/chat-attachment-download",
  );
  return { ...actual, fitBinaryAttachmentsToBudget: vi.fn(async (messages) => messages) };
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
            const usage = {
              inputTokens: state.inputTokens,
              inputTokenDetails: {
                noCacheTokens: undefined,
                cacheReadTokens: state.cacheReadTokens,
                cacheWriteTokens: undefined,
              },
              outputTokens: 2,
            };
            const streamStep = async (call: "streamed" | "rejected" | "silent" = "streamed") => {
              await options.onStepStart();
              // A call the provider rejects surfaces as an error before its stream starts.
              if (call === "rejected") {
                await options.onChunk({
                  chunk: { type: "error", error: new Error("Service unavailable") },
                });
                return;
              }
              // An accepted call can still be reading the prompt or reasoning.
              if (call === "silent") return;
              await options.onChunk({ chunk: { type: "start-step", request: {}, warnings: [] } });
              if (state.output)
                await options.onChunk({
                  chunk: { type: "text-delta", id: "text", text: "Partial answer" },
                });
            };
            await streamStep();
            if (state.usage || state.callEnded) await options.onLanguageModelCallEnd({ usage });
            if (state.usage)
              await options.onStepFinish({ usage, response: { messages: stepMessages } });
            if (state.nextStep)
              await streamStep(
                state.nextStepRejected ? "rejected" : state.nextStepSilent ? "silent" : "streamed",
              );
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
            if (state.upstreamError || state.nextStepRejected)
              controller.enqueue({ type: "error", errorText: "Service unavailable" });
            controller.enqueue({ type: state.mode === "finished" ? "finish" : "abort" });
            controller.close();
          },
        }),
    })),
  };
});

const { POST } = await import("../src/app/api/chat/route");
const { streamText } = await import("ai");
const {
  clearChatGenerationState,
  recordChatStopRequestedAt,
  replaceLastChatMessage,
  restoreStoppedRegeneration,
  updateChat,
} = await import("@/lib/chat");
const { fitBinaryAttachmentsToBudget } = await import("@/lib/chat-attachment-download");
const { maybeAutoSaveMemories } = await import("@/lib/memory");
const {
  GUEST_MAX_OUTPUT_TOKENS,
  GUEST_MAX_PROMPT_TOKENS,
  GUEST_TOOL_OUTPUT_CHARS,
  URL_PDF_TOKEN_ESTIMATE,
} = await import("../src/app/api/chat/_lib/usage-estimate");
const { clearChatGeneration, isCurrentChatGeneration, recordPromptUsage } =
  await import("@/lib/chat-generation");

beforeEach(() => {
  vi.clearAllMocks();
  // Forget the provider usage an earlier test reported for the shared chat and model.
  recordPromptUsage("user:chat:gpt-5.6-luna", { cacheReadTokens: 0 }, 0);
  state.activeGenerationId = null;
  state.stopRequestedAt = null;
  state.mode = "stopped";
  state.output = true;
  state.guest = false;
  state.usage = true;
  state.consumed = 0;
  state.refunded = 0;
  state.reported = 0;
  state.settled = 0;
  state.inputTokens = 10;
  state.cacheReadTokens = undefined;
  state.limitReached = false;
  state.failSettlement = false;
  state.callEnded = false;
  state.nextStep = false;
  state.nextStepRejected = false;
  state.nextStepSilent = false;
  state.upstreamError = false;
  state.memory = false;
  state.storedMessages = [];
});

function messagesRequest(messages: UIMessage[], body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "chat", model: "gpt-5.6-luna", messages, ...body }),
  });
}

function chatRequest(text = "Hello", parts: UIMessage["parts"] = [], model?: string) {
  return messagesRequest(
    [{ id: "user-message", role: "user", parts: [{ type: "text", text }, ...parts] }],
    model ? { model } : {},
  );
}

async function run(request = chatRequest()) {
  const response = await POST(request);
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
    // The first step's reported prompt was just sent, so it is read from cache.
    const retained =
      20 +
      Math.ceil(
        promptEstimate() + stepMessageTokens - state.inputTokens * 0.9 + streamedOutputAmount,
      );
    expect(state.consumed - state.refunded).toBe(retained);
    expect(state.reported).toBe(retained);
    if (mode === "replaced") clearChatGeneration("chat", "new-generation");
  },
);

test("a later step the provider rejects before streaming is not billed", async () => {
  state.mode = "finished";
  state.nextStep = true;
  state.nextStepRejected = true;
  await run();
  // Only the finished first step; the rejected request was never billed upstream.
  expect(state.consumed - state.refunded).toBe(20);
  expect(state.reported).toBe(20);
});

test("a later step stopped before its first stream part bills its prompt", async () => {
  // The provider accepted the call and is reading the prompt or reasoning.
  state.nextStep = true;
  state.nextStepSilent = true;
  await run();
  const stepMessageTokens = Math.ceil(JSON.stringify(stepMessages).length / 4);
  const retained = 20 + Math.ceil(promptEstimate() + stepMessageTokens - state.inputTokens * 0.9);
  expect(state.consumed - state.refunded).toBe(retained);
  expect(state.reported).toBe(retained);
});

test("a stop during a step's tool calls bills the call's reported usage", async () => {
  state.usage = false;
  state.callEnded = true;
  await run();
  expect(state.consumed - state.refunded).toBe(20);
  expect(state.reported).toBe(20);
});

test("a cut-off step bills the prompt the provider last read from cache at the cache-read weight", async () => {
  // Its own model keeps this chat's cache record out of the other tests.
  const request = () => chatRequest("Hello", [], "gpt-6-luna");
  state.mode = "finished";
  state.inputTokens = 1_000;
  state.cacheReadTokens = 1_000;
  await run(request());
  // 1,000 cache reads at 0.1 plus 2 output tokens at 5.
  expect(state.consumed - state.refunded).toBe(110);

  state.mode = "stopped";
  state.usage = false;
  state.consumed = 0;
  state.refunded = 0;
  await run(request());
  // The cut-off prompt is the one the provider reported and read from cache last time.
  expect(state.consumed - state.refunded).toBe(
    Math.ceil(Math.max(promptEstimate(), 1_000) * 0.1 + streamedOutputAmount),
  );
});

const pdfRequest = (model: string, text = "Summarize this") =>
  chatRequest(
    text,
    [{ type: "file", mediaType: "application/pdf", url: "https://example.com/report.pdf" }],
    model,
  );

test("a cut-off call counts the input the provider reported for the prompt it starts with", async () => {
  // Own model: keeps this chat's provider reports out of the other tests.
  const model = "report-carry-model";
  // The provider reported the PDF along with the text when this prompt finished.
  state.mode = "finished";
  state.inputTokens = 30_000;
  await run(pdfRequest(model));
  expect(state.consumed - state.refunded).toBe(30_010);

  // The same prompt, stopped mid-stream: the PDF counts, at the cache-read weight
  // because the provider was just sent it, as finishing would have been billed.
  state.mode = "stopped";
  state.usage = false;
  state.consumed = 0;
  state.refunded = 0;
  await run(pdfRequest(model));
  const retained = state.consumed - state.refunded;
  expect(retained).toBe(Math.ceil(30_000 * 0.1 + streamedOutputAmount));
  expect(retained).toBeLessThanOrEqual(30_010);
});

test("a report for a prompt this one does not start with is not carried over", async () => {
  const model = "report-mismatch-model";
  state.mode = "finished";
  state.inputTokens = 30_000;
  await run(pdfRequest(model));

  // An edited question no longer starts with the reported prompt (and its PDF).
  state.mode = "stopped";
  state.usage = false;
  state.consumed = 0;
  state.refunded = 0;
  await run(chatRequest("A different question", [], model));
  expect(state.consumed - state.refunded).toBe(promptEstimate() + streamedOutputAmount);
});

test("a cut-off later step counts the input reported for the step before it", async () => {
  const model = "report-step-model";
  state.inputTokens = 30_000;
  state.nextStep = true;
  await run(pdfRequest(model));
  const stepMessageTokens = Math.ceil(JSON.stringify(stepMessages).length / 4);
  // The first step's reported usage, then the second step's prompt: the first
  // step's reported input (read from cache) plus its tool messages.
  expect(state.consumed - state.refunded).toBe(
    30_010 + Math.ceil(stepMessageTokens + 30_000 * 0.1 + streamedOutputAmount),
  );
});

test("a stopped first call bills its prompt text but not the reserved attachment floors", async () => {
  state.usage = false;
  await run(
    chatRequest("Summarize this", [
      { type: "file", mediaType: "application/pdf", url: "https://example.com/report.pdf" },
    ]),
  );
  const retained = state.consumed - state.refunded;
  expect(retained).toBeGreaterThan(streamedOutputAmount);
  expect(retained).toBeLessThanOrEqual(
    promptEstimate() - URL_PDF_TOKEN_ESTIMATE + streamedOutputAmount,
  );
});

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

test("guests cannot send several PDFs by URL for one request unit", async () => {
  state.guest = true;
  const pdf = (name: string) => ({
    type: "file" as const,
    mediaType: "application/pdf",
    url: `https://example.com/${name}.pdf`,
  });
  const response = await POST(chatRequest("Summarize", [pdf("a"), pdf("b")]));
  expect(response.status).toBe(413);
  expect(state.consumed).toBe(0);
  expect(streamText).not.toHaveBeenCalled();
});

test("a guest PDF counts by the size downloaded before the check", async () => {
  state.guest = true;
  state.mode = "finished";
  const url = "https://example.com/report.pdf";
  const pdf = { type: "file" as const, mediaType: "application/pdf", url };
  const downloaded = (bytes: number) =>
    vi.mocked(fitBinaryAttachmentsToBudget).mockImplementationOnce(async (messages, cache) => {
      cache.set(url, { data: new Uint8Array(bytes), mediaType: "application/pdf" });
      return messages;
    });

  // A short PDF fits.
  downloaded(40_000);
  await run(chatRequest("Summarize", [pdf]));
  expect(streamText).toHaveBeenCalledOnce();

  // A long one no longer passes as a flat per-file estimate.
  downloaded(1_000_000);
  const response = await POST(chatRequest("Summarize", [pdf]));
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ reason: "guest_prompt_too_long" });
  expect(streamText).toHaveBeenCalledOnce();
});

test("guests cannot send a large inline PDF for one request unit", async () => {
  state.guest = true;
  // About 300 KB, decoded.
  const url = `data:application/pdf;base64,${"A".repeat(400_000)}`;
  const response = await POST(
    chatRequest("Summarize", [{ type: "file", mediaType: "application/pdf", url }]),
  );
  expect(response.status).toBe(413);
  expect(state.consumed).toBe(0);
  expect(streamText).not.toHaveBeenCalled();
});

test("a guest image counts per file, not by its encoded size", async () => {
  state.guest = true;
  state.mode = "finished";
  // A ~96KB image sent inline when no upload storage is configured.
  const url = `data:image/png;base64,${"A".repeat(4 * GUEST_MAX_PROMPT_TOKENS + 4)}`;
  await run(chatRequest("What is this?", [{ type: "file", mediaType: "image/png", url }]));
  expect(streamText).toHaveBeenCalledOnce();
});

test("guests resend earlier tool results shortened", async () => {
  state.guest = true;
  state.mode = "finished";
  const output = { content: "x".repeat(4 * GUEST_MAX_PROMPT_TOKENS) };
  await run(
    messagesRequest([
      { id: "question", role: "user", parts: [{ type: "text", text: "Read this page" }] },
      {
        id: "answer",
        role: "assistant",
        parts: [
          {
            type: "tool-browse",
            toolCallId: "call",
            state: "output-available",
            input: { url: "https://example.com" },
            output,
          },
          { type: "text", text: "It says x." },
        ],
      },
      { id: "follow-up", role: "user", parts: [{ type: "text", text: "Thanks" }] },
    ]),
  );
  const prompt = JSON.stringify(vi.mocked(streamText).mock.lastCall?.[0].messages);
  expect(prompt).toContain("[truncated]");
  expect(prompt.length).toBeLessThan(GUEST_TOOL_OUTPUT_CHARS * 2);
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

async function stopChat() {
  const { POST: stop } = await import("@/app/api/chat/stop/route");
  const response = await stop(
    new Request("http://localhost/api/chat/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "chat" }),
    }),
  );
  expect(response.status).toBe(200);
}

test("a stop request that arrives before the generation registers cancels it", async () => {
  // The stop is handled while the request is still preparing, so it finds
  // no active generation; then the request registers its own.
  vi.mocked(updateChat).mockImplementationOnce(async (_id, _user, _messages, _title, options) => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await stopChat();
    state.activeGenerationId = options?.nextGenerationId ?? null;
    return { id: "chat", stopRequestedAt: state.stopRequestedAt };
  });

  const response = await POST(chatRequest());

  expect(response.status).toBe(499);
  expect(streamText).not.toHaveBeenCalled();
  expect(state.consumed).toBe(0);
  // Rolled back to the question without the pending answer.
  expect(vi.mocked(updateChat).mock.lastCall?.[2]).toEqual([
    expect.objectContaining({ id: "user-message", role: "user" }),
  ]);
  // Recorded on the chat row too, for a request on another instance.
  expect(recordChatStopRequestedAt).toHaveBeenCalledWith("chat", "user", expect.any(Date));
});

test("a stop another instance handled before the generation registers cancels it", async () => {
  // The other instance found no generation to stop and only recorded the stop on
  // the chat row; this instance has no stop in memory.
  vi.mocked(updateChat).mockImplementationOnce(async (_id, _user, _messages, _title, options) => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    state.stopRequestedAt = new Date();
    state.activeGenerationId = options?.nextGenerationId ?? null;
    return { id: "chat", stopRequestedAt: state.stopRequestedAt };
  });

  const response = await POST(chatRequest());

  expect(response.status).toBe(499);
  expect(streamText).not.toHaveBeenCalled();
  expect(state.consumed).toBe(0);
  expect(vi.mocked(updateChat).mock.lastCall?.[2]).toEqual([
    expect.objectContaining({ id: "user-message", role: "user" }),
  ]);
});

test("a stop recorded on the chat row before a request arrived does not cancel it", async () => {
  state.stopRequestedAt = new Date(Date.now() - 1_000);
  state.mode = "finished";
  await run();
  expect(streamText).toHaveBeenCalledOnce();
  expect(clearChatGenerationState).toHaveBeenCalledOnce();
});

test("a client disconnect before the generation registers does not cancel it", async () => {
  const controller = new AbortController();
  state.mode = "finished";
  // Leaving the chat aborts the request while attachments are being prepared.
  vi.mocked(fitBinaryAttachmentsToBudget).mockImplementationOnce(async (messages) => {
    controller.abort();
    return messages;
  });

  await run(new Request(chatRequest(), { signal: controller.signal }));

  expect(vi.mocked(fitBinaryAttachmentsToBudget).mock.lastCall?.[2].aborted).toBe(false);
  expect(streamText).toHaveBeenCalledOnce();
  expect(clearChatGenerationState).toHaveBeenCalledOnce();
});

test("an earlier stop does not cancel a request sent after it", async () => {
  await stopChat();
  await new Promise((resolve) => setTimeout(resolve, 5));
  state.mode = "finished";
  await run();
  expect(streamText).toHaveBeenCalledOnce();
});

test.each([false, true])(
  "a regenerate that fails before streaming keeps the stored answer (pending: %s)",
  async (pending) => {
    const { consumeUsage, UsageLimitError } = await import("@/lib/usage");
    const question: UIMessage = {
      id: "user-message",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    };
    const answer: UIMessage = {
      id: "answer",
      role: "assistant",
      parts: [{ type: "text", text: "Original answer" }],
    };
    // A pending answer belonged to a generation the regenerate replaced.
    state.storedMessages = [
      question,
      pending ? { ...answer, metadata: { pending: true } } : answer,
    ];
    // The token reservation exceeds a positive but low remaining balance.
    vi.mocked(consumeUsage).mockRejectedValueOnce(new UsageLimitError("Usage limit reached"));

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "chat",
          model: "gpt-5.6-luna",
          trigger: "regenerate-message",
          messageId: "answer",
          messages: [question],
        }),
      }),
    );

    expect(response.status).toBe(402);
    expect(vi.mocked(updateChat).mock.lastCall?.[2]).toEqual([
      question,
      pending ? { ...answer, metadata: {} } : answer,
    ]);
  },
);

const question: UIMessage = {
  id: "user-message",
  role: "user",
  parts: [{ type: "text", text: "Hello" }],
};
const answer: UIMessage = {
  id: "answer",
  role: "assistant",
  parts: [{ type: "text", text: "Original answer" }],
};
const regenerateRequest = () =>
  messagesRequest([question], { trigger: "regenerate-message", messageId: "answer" });

test("a regenerate that fails upstream before any output keeps the stored answer", async () => {
  state.storedMessages = [question, answer];
  state.mode = "finished";
  state.output = false;
  state.usage = false;
  state.upstreamError = true;
  await run(regenerateRequest());

  expect(vi.mocked(updateChat).mock.lastCall?.[2]).toEqual([question, answer]);
  expect(vi.mocked(updateChat).mock.lastCall?.[4]).toMatchObject({ nextGenerationId: null });
  expect(clearChatGenerationState).not.toHaveBeenCalled();
  expect(state.refunded).toBe(state.consumed);
});

test.each([false, true])(
  "a regenerate stopped after registering restores the stored answer only without output (output: %s)",
  async (output) => {
    state.storedMessages = [question, answer];
    state.output = output;
    state.usage = false;
    await run(regenerateRequest());

    if (output) {
      expect(restoreStoppedRegeneration).not.toHaveBeenCalled();
    } else {
      expect(restoreStoppedRegeneration).toHaveBeenCalledWith("chat", "user", expect.any(String), [
        question,
        answer,
      ]);
    }
  },
);
