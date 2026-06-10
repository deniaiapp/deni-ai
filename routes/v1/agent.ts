import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  validateAgentRequest,
  validateResponsesRequest,
} from "../../middleware/validateRequest";
import { validateAnthropicRequest } from "../../middleware/validateAnthropicRequest";
import {
  validateAgentAuth,
  type AgentAuthContext,
} from "../../middleware/validateAgentAuth";
import { recordUsageQuota, releaseUsageQuota } from "../../utils/deni";
import {
  type AgentRequest,
  type ResponsesRequest,
  applyAnthropicNativePromptCaching,
  applyAutomaticPromptCaching,
  getClient,
  isAnthropicModel,
  convertAnthropicResponseToOpenAI,
  convertAnthropicStreamEventToOpenAI,
  convertMessagesToAnthropic,
  convertToolsToAnthropic,
  extractAnthropicSystemPrompt,
  convertMessagesToResponsesInput,
  convertToolsToOpenRouter,
} from "../../utils/agent";
import { computeMeteredTokens } from "../../utils/agent/usageMetering";

const router = new Hono<{
  Variables: {
    validatedBody: AgentRequest | ResponsesRequest;
    agentAuth: AgentAuthContext;
  };
}>();

const anthropicFailoverClient = new Anthropic({
  apiKey: Bun.env.ANTHROPIC_API_KEY || "",
});

const OPENROUTER_MESSAGES_FAILOVER_TTL_MS = 60 * 60 * 1000;
const openRouterMessagesFailoverCache = new Map<
  string,
  {
    expiresAt: number;
    status: number;
  }
>();

// Resolved once at startup so the hot path can skip all debug work
// (summaries, extra SSE JSON.parse passes) with a single boolean check.
const AGENT_DEBUG_LOGS_ENABLED = (() => {
  const value = Bun.env.FLIXA_AGENT_DEBUG_LOGS?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
})();

/**
 * Debug log with optionally-lazy payload: pass a thunk for payloads that are
 * expensive to build (message/tool summaries) so they are only computed when
 * debug logging is actually enabled.
 */
function agentDebugLog(
  event: string,
  data: Record<string, unknown> | (() => Record<string, unknown>),
): void {
  if (!AGENT_DEBUG_LOGS_ENABLED) {
    return;
  }

  const payload = typeof data === "function" ? data() : data;
  console.log(
    `[AgentDebug] ${event} ${JSON.stringify({
      ts: new Date().toISOString(),
      ...payload,
    })}`,
  );
}

function getNumericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mergeUsageSnapshot(
  current: Record<string, number>,
  usage: unknown,
): Record<string, number> {
  if (!usage || typeof usage !== "object") {
    return current;
  }

  const next = { ...current };
  for (const [key, value] of Object.entries(usage as Record<string, unknown>)) {
    const numericValue = getNumericValue(value);
    if (numericValue !== null) {
      next[key] = numericValue;
      continue;
    }

    // Flatten OpenAI-style `prompt_tokens_details.cached_tokens` so the
    // cache-read breakdown survives into the snapshot for weighted metering.
    if (
      (key === "prompt_tokens_details" ||
        key === "promptTokensDetails" ||
        key === "input_tokens_details" ||
        key === "inputTokensDetails") &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const details = value as Record<string, unknown>;
      const cachedTokens =
        getNumericValue(details.cached_tokens) ??
        getNumericValue(details.cachedTokens);
      if (cachedTokens !== null) {
        next.cached_tokens = cachedTokens;
      }
    }
  }

  return next;
}

function getContentSummary(content: unknown): Record<string, unknown> {
  if (typeof content === "string") {
    return { kind: "string", length: content.length };
  }

  if (Array.isArray(content)) {
    return {
      kind: "array",
      blocks: content.map((block) => {
        if (!block || typeof block !== "object" || Array.isArray(block)) {
          return { type: typeof block };
        }

        const record = block as Record<string, unknown>;
        return {
          type: record.type,
          textLength:
            typeof record.text === "string" ? record.text.length : undefined,
        };
      }),
    };
  }

  if (content === null) {
    return { kind: "null" };
  }

  return { kind: typeof content };
}

function summarizeChatMessage(message: unknown): Record<string, unknown> {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { type: typeof message };
  }

  const record = message as Record<string, unknown>;
  const toolCalls = Array.isArray(record.tool_calls)
    ? record.tool_calls
    : Array.isArray(record.toolCalls)
      ? record.toolCalls
      : undefined;

  return {
    role: record.role,
    content:
      record.content !== undefined
        ? getContentSummary(record.content)
        : undefined,
    tool_call_id:
      typeof record.tool_call_id === "string" ? record.tool_call_id : undefined,
    toolCalls: toolCalls?.map((toolCall) => {
      if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
        return { type: typeof toolCall };
      }

      const toolCallRecord = toolCall as Record<string, unknown>;
      const fn =
        toolCallRecord.function &&
        typeof toolCallRecord.function === "object" &&
        !Array.isArray(toolCallRecord.function)
          ? (toolCallRecord.function as Record<string, unknown>)
          : {};

      return {
        id: toolCallRecord.id,
        type: toolCallRecord.type,
        name: fn.name,
        argumentsLength:
          typeof fn.arguments === "string" ? fn.arguments.length : undefined,
      };
    }),
  };
}

function summarizeChatMessages(messages: unknown[]): Record<string, unknown> {
  return {
    count: messages.length,
    tail: messages.slice(-8).map(summarizeChatMessage),
  };
}

function summarizeTools(tools: unknown): unknown {
  if (!Array.isArray(tools)) {
    return undefined;
  }

  return tools.map((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      return { type: typeof tool };
    }

    const record = tool as Record<string, unknown>;
    const fn =
      record.function &&
      typeof record.function === "object" &&
      !Array.isArray(record.function)
        ? (record.function as Record<string, unknown>)
        : {};

    return {
      type: record.type,
      name: record.name ?? fn.name,
    };
  });
}

function summarizeToolChoice(toolChoice: unknown): unknown {
  if (!toolChoice || typeof toolChoice !== "object") {
    return toolChoice;
  }

  const record = toolChoice as Record<string, unknown>;
  const fn =
    record.function &&
    typeof record.function === "object" &&
    !Array.isArray(record.function)
      ? (record.function as Record<string, unknown>)
      : {};

  return {
    type: record.type,
    name: record.name ?? fn.name,
  };
}

function collectAnthropicUsageFromSseEvent(
  eventBlock: string,
  usageSnapshot: Record<string, number>,
): Record<string, number> {
  const payload = eventBlock
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!payload || payload === "[DONE]") {
    return usageSnapshot;
  }

  try {
    const event = JSON.parse(payload) as {
      type?: string;
      message?: { usage?: unknown };
      usage?: unknown;
      delta?: { usage?: unknown };
    };

    if (event.type === "message_start" && event.message?.usage) {
      return mergeUsageSnapshot(usageSnapshot, event.message.usage);
    }

    if (event.usage) {
      return mergeUsageSnapshot(usageSnapshot, event.usage);
    }

    if (event.delta?.usage) {
      return mergeUsageSnapshot(usageSnapshot, event.delta.usage);
    }
  } catch {
    return usageSnapshot;
  }

  return usageSnapshot;
}

function getResponsesBaseUrl(
  clientResult: Extract<
    ReturnType<typeof getClient>,
    { type: "openrouter" | "openai" }
  >,
): string {
  if (clientResult.type === "openrouter") {
    return "https://openrouter.ai/api/v1/responses";
  }

  return `${Bun.env.OPENAI_COMPAT_BASE_URL || "https://capi.voids.top/v2"}/responses`;
}

function getResponsesHeaders(
  clientResult: Extract<
    ReturnType<typeof getClient>,
    { type: "openrouter" | "openai" }
  >,
): Record<string, string> {
  if (clientResult.type === "openrouter") {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Bun.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://flixa.deniai.app",
      "X-OpenRouter-Title": "Deni AI Flixa",
      "X-OpenRouter-Categories": "cli-agent,ide-extension",
      "X-OpenRouter-Experimental-Metadata": "enabled",
    };
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${Bun.env.OPENAI_COMPAT_API_KEY || "a"}`,
  };
}

function getOpenRouterProviderRouting(
  model: string,
): { only: string[] } | undefined {
  if (isAnthropicModel(model)) {
    return { only: ["anthropic"] };
  }

  return undefined;
}

function hasAnthropicFailoverKey(): boolean {
  return Boolean(Bun.env.ANTHROPIC_API_KEY);
}

function shouldFailoverToAnthropic(status: number, model: string): boolean {
  return status === 402 && isAnthropicModel(model) && hasAnthropicFailoverKey();
}

function getOpenRouterMessagesFailoverCacheKey(model: string): string {
  return model.toLowerCase();
}

function getOpenRouterMessagesFailoverState(
  model: string,
): { expiresAt: number; status: number } | null {
  const cacheKey = getOpenRouterMessagesFailoverCacheKey(model);
  const state = openRouterMessagesFailoverCache.get(cacheKey);
  if (!state) {
    return null;
  }

  if (state.expiresAt <= Date.now()) {
    openRouterMessagesFailoverCache.delete(cacheKey);
    return null;
  }

  return state;
}

function setOpenRouterMessagesFailoverState(
  model: string,
  status: number,
): void {
  openRouterMessagesFailoverCache.set(
    getOpenRouterMessagesFailoverCacheKey(model),
    {
      expiresAt: Date.now() + OPENROUTER_MESSAGES_FAILOVER_TTL_MS,
      status,
    },
  );
}

function clearOpenRouterMessagesFailoverState(model: string): void {
  openRouterMessagesFailoverCache.delete(
    getOpenRouterMessagesFailoverCacheKey(model),
  );
}

function toAnthropicModelName(model: string): string {
  return model.startsWith("anthropic/")
    ? model.slice("anthropic/".length)
    : model;
}

function getAnthropicHeaders(requestHeaders: Headers): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": Bun.env.ANTHROPIC_API_KEY || "",
    "anthropic-version":
      requestHeaders.get("anthropic-version") || "2023-06-01",
  };

  for (const [key, value] of requestHeaders.entries()) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.startsWith("anthropic-") &&
      normalizedKey !== "anthropic-version"
    ) {
      headers[normalizedKey] = value;
    }
  }

  return headers;
}

function normalizeResponsesTools(
  tools: ResponsesRequest["tools"],
): unknown[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") {
      return tool;
    }

    const toolRecord = tool as unknown as Record<string, unknown>;
    if (toolRecord.type !== "function") {
      return tool;
    }

    if (typeof toolRecord.name === "string") {
      return {
        type: "function",
        name: toolRecord.name,
        description:
          typeof toolRecord.description === "string"
            ? toolRecord.description
            : undefined,
        parameters:
          toolRecord.parameters &&
          typeof toolRecord.parameters === "object" &&
          !Array.isArray(toolRecord.parameters)
            ? toolRecord.parameters
            : undefined,
        strict:
          typeof toolRecord.strict === "boolean"
            ? toolRecord.strict
            : undefined,
      };
    }

    const functionRecord =
      toolRecord.function &&
      typeof toolRecord.function === "object" &&
      !Array.isArray(toolRecord.function)
        ? (toolRecord.function as Record<string, unknown>)
        : null;

    if (!functionRecord || typeof functionRecord.name !== "string") {
      return tool;
    }

    return {
      type: "function",
      name: functionRecord.name,
      description:
        typeof functionRecord.description === "string"
          ? functionRecord.description
          : undefined,
      parameters:
        functionRecord.parameters &&
        typeof functionRecord.parameters === "object" &&
        !Array.isArray(functionRecord.parameters)
          ? functionRecord.parameters
          : undefined,
      strict:
        typeof functionRecord.strict === "boolean"
          ? functionRecord.strict
          : undefined,
    };
  });
}

function normalizeResponsesToolChoice(
  toolChoice: ResponsesRequest["tool_choice"],
  hasToolOutput = false,
): unknown {
  if (hasToolOutput && toolChoice !== undefined && toolChoice !== "none") {
    return "auto";
  }

  if (
    toolChoice === undefined ||
    toolChoice === "none" ||
    toolChoice === "auto" ||
    toolChoice === "required"
  ) {
    return toolChoice;
  }

  if (!toolChoice || typeof toolChoice !== "object") {
    return toolChoice;
  }

  const toolChoiceRecord = toolChoice as unknown as Record<string, unknown>;
  if (
    toolChoiceRecord.type === "function" &&
    typeof toolChoiceRecord.name === "string"
  ) {
    return {
      type: "function",
      name: toolChoiceRecord.name,
    };
  }

  const functionRecord =
    toolChoiceRecord.function &&
    typeof toolChoiceRecord.function === "object" &&
    !Array.isArray(toolChoiceRecord.function)
      ? (toolChoiceRecord.function as Record<string, unknown>)
      : null;

  if (
    toolChoiceRecord.type === "function" &&
    functionRecord &&
    typeof functionRecord.name === "string"
  ) {
    return {
      type: "function",
      name: functionRecord.name,
    };
  }

  return toolChoice;
}

function normalizeOpenRouterToolChoice(
  toolChoice: AgentRequest["tool_choice"],
  hasToolResult = false,
): unknown {
  if (hasToolResult && toolChoice !== undefined && toolChoice !== "none") {
    return "auto";
  }

  if (
    toolChoice === undefined ||
    toolChoice === "none" ||
    toolChoice === "auto" ||
    toolChoice === "required"
  ) {
    return toolChoice;
  }

  if (!toolChoice || typeof toolChoice !== "object") {
    return undefined;
  }

  const toolChoiceRecord = toolChoice as unknown as Record<string, unknown>;
  const functionRecord =
    toolChoiceRecord.function &&
    typeof toolChoiceRecord.function === "object" &&
    !Array.isArray(toolChoiceRecord.function)
      ? (toolChoiceRecord.function as Record<string, unknown>)
      : null;

  if (
    toolChoiceRecord.type === "function" &&
    functionRecord &&
    typeof functionRecord.name === "string"
  ) {
    return {
      type: "function",
      function: {
        name: functionRecord.name,
      },
    };
  }

  return undefined;
}

function normalizeOpenAIChatToolChoice(
  toolChoice: AgentRequest["tool_choice"],
  hasToolResult: boolean,
): AgentRequest["tool_choice"] | undefined {
  if (hasToolResult && toolChoice !== undefined && toolChoice !== "none") {
    return "auto";
  }

  return toolChoice;
}

function hasChatToolResult(messages: AgentRequest["messages"]): boolean {
  return messages[messages.length - 1]?.role === "tool";
}

function hasResponsesToolOutput(input: unknown): boolean {
  if (!Array.isArray(input)) {
    return false;
  }

  const lastInput = input[input.length - 1];
  if (!lastInput || typeof lastInput !== "object" || Array.isArray(lastInput)) {
    return false;
  }

  const record = lastInput as Record<string, unknown>;
  return record.type === "function_call_output" || record.role === "tool";
}

function hasAnthropicToolResult(
  messages: Anthropic.Messages.MessageCreateParams["messages"],
): boolean {
  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role !== "user" || !Array.isArray(lastMessage.content)) {
    return false;
  }

  return lastMessage.content.some((block) => block.type === "tool_result");
}

function normalizeAnthropicToolChoiceAfterToolResult(
  body: Anthropic.Messages.MessageCreateParams,
): Anthropic.Messages.MessageCreateParams["tool_choice"] {
  const toolChoice = body.tool_choice;
  if (
    !hasAnthropicToolResult(body.messages) ||
    toolChoice === undefined ||
    toolChoice.type === "none" ||
    toolChoice.type === "auto"
  ) {
    return toolChoice;
  }

  return { type: "auto" };
}

function normalizeAnthropicChatToolChoice(
  toolChoice: AgentRequest["tool_choice"],
  hasToolResult: boolean,
): Anthropic.Messages.MessageCreateParams["tool_choice"] {
  if (hasToolResult && toolChoice !== undefined && toolChoice !== "none") {
    return { type: "auto" };
  }

  if (toolChoice === undefined) {
    return undefined;
  }

  if (toolChoice === "none" || toolChoice === "auto") {
    return { type: toolChoice };
  }

  if (toolChoice === "required") {
    return { type: "any" };
  }

  if (!toolChoice || typeof toolChoice !== "object") {
    return undefined;
  }

  const toolChoiceRecord = toolChoice as unknown as Record<string, unknown>;
  const functionRecord =
    toolChoiceRecord.function &&
    typeof toolChoiceRecord.function === "object" &&
    !Array.isArray(toolChoiceRecord.function)
      ? (toolChoiceRecord.function as Record<string, unknown>)
      : null;

  if (
    toolChoiceRecord.type === "function" &&
    functionRecord &&
    typeof functionRecord.name === "string"
  ) {
    return { type: "tool", name: functionRecord.name };
  }

  return undefined;
}

function hasChatToolTranscript(input: unknown[]): boolean {
  return input.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }

    const record = item as Record<string, unknown>;
    return record.role === "tool" || Array.isArray(record.tool_calls);
  });
}

function normalizeResponsesInput(body: ResponsesRequest): unknown {
  if (body.input !== undefined) {
    if (Array.isArray(body.input) && hasChatToolTranscript(body.input)) {
      return convertMessagesToResponsesInput(
        body.input as AgentRequest["messages"],
      );
    }

    return body.input;
  }

  if (body.messages !== undefined) {
    return convertMessagesToResponsesInput(body.messages);
  }

  return undefined;
}

function normalizeResponsesRequest(
  body: ResponsesRequest,
): Record<string, unknown> {
  const normalizedInput = normalizeResponsesInput(body);
  const normalized: Record<string, unknown> = {
    model: body.model,
    input: normalizedInput,
  };

  if (body.instructions !== undefined) {
    normalized.instructions = body.instructions;
  }

  if (body.previous_response_id !== undefined) {
    normalized.previous_response_id = body.previous_response_id;
  }

  if (body.stream !== undefined) {
    normalized.stream = body.stream;
  }

  if (body.temperature !== undefined) {
    normalized.temperature = body.temperature;
  }

  if (body.top_p !== undefined) {
    normalized.top_p = body.top_p;
  }

  const maxOutputTokens = body.max_output_tokens ?? body.max_tokens;
  if (maxOutputTokens !== undefined) {
    normalized.max_output_tokens = maxOutputTokens;
  }

  const reasoning =
    body.reasoning ??
    (body.reasoning_effort ? { effort: body.reasoning_effort } : undefined);
  if (reasoning !== undefined) {
    normalized.reasoning = reasoning;
  }

  if (body.tools !== undefined) {
    normalized.tools = normalizeResponsesTools(body.tools);
  }

  if (body.tool_choice !== undefined) {
    normalized.tool_choice = normalizeResponsesToolChoice(
      body.tool_choice,
      hasResponsesToolOutput(normalizedInput),
    );
  }

  if (body.text !== undefined) {
    normalized.text = body.text;
  }

  if (body.store !== undefined) {
    normalized.store = body.store;
  }

  if (body.include !== undefined) {
    normalized.include = body.include;
  }

  if (body.parallel_tool_calls !== undefined) {
    normalized.parallel_tool_calls = body.parallel_tool_calls;
  }

  if (body.metadata !== undefined) {
    normalized.metadata = body.metadata;
  }

  return normalized;
}

function collectResponsesUsageFromSseEvent(
  eventBlock: string,
  usageSnapshot: Record<string, number>,
): Record<string, number> {
  const payload = eventBlock
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!payload || payload === "[DONE]") {
    return usageSnapshot;
  }

  try {
    const event = JSON.parse(payload) as {
      type?: string;
      response?: { usage?: unknown };
      usage?: unknown;
      item?: { usage?: unknown };
    };

    if (event.response?.usage) {
      return mergeUsageSnapshot(usageSnapshot, event.response.usage);
    }

    if (event.usage) {
      return mergeUsageSnapshot(usageSnapshot, event.usage);
    }

    if (event.item?.usage) {
      return mergeUsageSnapshot(usageSnapshot, event.item.usage);
    }
  } catch {
    return usageSnapshot;
  }

  return usageSnapshot;
}

function collectChatUsageFromSseEvent(
  eventBlock: string,
  usageSnapshot: Record<string, number>,
): Record<string, number> {
  const payload = eventBlock
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!payload || payload === "[DONE]") {
    return usageSnapshot;
  }

  try {
    const event = JSON.parse(payload) as { usage?: unknown };
    if (event.usage) {
      return mergeUsageSnapshot(usageSnapshot, event.usage);
    }
  } catch {
    return usageSnapshot;
  }

  return usageSnapshot;
}

interface ChatStreamDebugSummary {
  chunks: number;
  contentDeltaChars: number;
  finishReasons: string[];
  toolCallDeltas: Array<{
    index?: number;
    id?: unknown;
    type?: unknown;
    name?: unknown;
    argumentsLength?: number;
  }>;
}

function createChatStreamDebugSummary(): ChatStreamDebugSummary {
  return {
    chunks: 0,
    contentDeltaChars: 0,
    finishReasons: [],
    toolCallDeltas: [],
  };
}

function collectChatDebugFromSseEvent(
  eventBlock: string,
  summary: ChatStreamDebugSummary,
): void {
  // This is a debug-only second JSON.parse pass over every SSE chunk —
  // skip it entirely unless debug logging is on.
  if (!AGENT_DEBUG_LOGS_ENABLED) {
    return;
  }

  const payload = eventBlock
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!payload || payload === "[DONE]") {
    return;
  }

  try {
    const event = JSON.parse(payload) as {
      choices?: Array<{
        delta?: {
          content?: unknown;
          tool_calls?: unknown;
          toolCalls?: unknown;
        };
        finish_reason?: unknown;
        finishReason?: unknown;
      }>;
    };

    summary.chunks += 1;

    for (const choice of event.choices ?? []) {
      if (typeof choice.delta?.content === "string") {
        summary.contentDeltaChars += choice.delta.content.length;
      }

      const finishReason = choice.finish_reason ?? choice.finishReason;
      if (typeof finishReason === "string") {
        summary.finishReasons.push(finishReason);
      }

      const toolCalls = Array.isArray(choice.delta?.tool_calls)
        ? choice.delta.tool_calls
        : Array.isArray(choice.delta?.toolCalls)
          ? choice.delta.toolCalls
          : [];

      for (const toolCall of toolCalls) {
        if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
          continue;
        }

        const toolCallRecord = toolCall as Record<string, unknown>;
        const fn =
          toolCallRecord.function &&
          typeof toolCallRecord.function === "object" &&
          !Array.isArray(toolCallRecord.function)
            ? (toolCallRecord.function as Record<string, unknown>)
            : {};

        summary.toolCallDeltas.push({
          index:
            typeof toolCallRecord.index === "number"
              ? toolCallRecord.index
              : undefined,
          id: toolCallRecord.id,
          type: toolCallRecord.type,
          name: fn.name,
          argumentsLength:
            typeof fn.arguments === "string" ? fn.arguments.length : undefined,
        });
      }
    }
  } catch {
    return;
  }
}

function summarizeChatCompletionResponse(response: unknown): Record<string, unknown> {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return { type: typeof response };
  }

  const record = response as Record<string, unknown>;
  return {
    id: record.id,
    model: record.model,
    choices: Array.isArray(record.choices)
      ? record.choices.map((choice) => {
          if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
            return { type: typeof choice };
          }

          const choiceRecord = choice as Record<string, unknown>;
          return {
            index: choiceRecord.index,
            finishReason: choiceRecord.finish_reason ?? choiceRecord.finishReason,
            message: summarizeChatMessage(choiceRecord.message),
          };
        })
      : undefined,
    usage: record.usage,
  };
}

async function finalizeUsage(
  auth: AgentAuthContext | undefined,
  usage: unknown,
): Promise<void> {
  if (!auth) return;

  auth.usageReserved = false;

  if (auth.usageUnit !== "tokens") {
    return;
  }

  // Cost-weighted: cache reads/writes and output tokens are weighted by
  // their relative upstream price instead of counted 1:1.
  const weightedTokens = computeMeteredTokens(usage);
  if (weightedTokens === null || weightedTokens <= 0) {
    return;
  }

  try {
    const meteredTokens = Math.ceil(weightedTokens * auth.tokenUsageMultiplier);
    await recordUsageQuota(
      auth.userId,
      auth.modelCategory,
      auth.tier,
      meteredTokens,
      auth.hasVerifiedPaymentMethod,
    );
  } catch (error) {
    console.error(
      `[Usage] Failed to finalize token usage for user=${auth.userId} category=${auth.modelCategory}:`,
      error,
    );
  }
}

async function releaseReservedUsage(
  auth: AgentAuthContext | undefined,
): Promise<void> {
  if (!auth?.usageReserved) return;
  auth.usageReserved = false;
  await releaseUsageQuota(auth.userId, auth.modelCategory, auth.tier);
}

async function createAnthropicChatFailoverResponse(
  auth: AgentAuthContext,
  requestId: string,
  body: AgentRequest,
  hasToolResult: boolean,
): Promise<Response> {
  const {
    messages,
    model,
    stream,
    temperature,
    max_tokens,
    top_p,
    tools,
    tool_choice,
  } = body;
  const anthropicModel = toAnthropicModelName(model);
  const anthropicMessages = convertMessagesToAnthropic(messages);
  const anthropicTools = convertToolsToAnthropic(tools);
  const system = extractAnthropicSystemPrompt(messages);
  const normalizedToolChoice = normalizeAnthropicChatToolChoice(
    tool_choice,
    hasToolResult,
  );

  // The native Anthropic API has no top-level cache_control (unlike
  // OpenRouter), so add explicit breakpoints to keep prompt caching working
  // during failover.
  const requestParams = applyAnthropicNativePromptCaching({
    model: anthropicModel,
    messages: anthropicMessages,
    stream: stream ?? false,
    max_tokens: max_tokens ?? 4096,
    temperature: temperature ?? undefined,
    top_p: top_p ?? undefined,
    system,
    tools: anthropicTools,
    tool_choice: normalizedToolChoice,
  } satisfies Anthropic.Messages.MessageCreateParams);

  agentDebugLog("chat.failover_request", () => ({
    requestId,
    provider: "anthropic",
    model: anthropicModel,
    stream: requestParams.stream,
    toolChoice: normalizedToolChoice,
    tools: summarizeTools(anthropicTools),
    messages: summarizeChatMessages(anthropicMessages),
  }));

  if (stream) {
    const abortController = new AbortController();
    const streamResponse = await anthropicFailoverClient.messages.create(
      {
        ...requestParams,
        stream: true,
      },
      { signal: abortController.signal },
    );

    const encoder = new TextEncoder();
    let usageSnapshot: Record<string, number> = {};
    let usageSettled = false;
    const readable = new ReadableStream({
      async start(controller) {
        let messageId = `chatcmpl_${requestId}`;
        const streamDebug = createChatStreamDebugSummary();

        try {
          for await (const event of streamResponse) {
            if (event.type === "message_start") {
              messageId = event.message.id;
              usageSnapshot = mergeUsageSnapshot(
                usageSnapshot,
                event.message.usage,
              );
            }

            if (event.type === "message_delta" && event.usage) {
              usageSnapshot = mergeUsageSnapshot(usageSnapshot, event.usage);
            }

            const chunk = convertAnthropicStreamEventToOpenAI(
              event,
              messageId,
              model,
            );
            if (!chunk) {
              continue;
            }

            const data = JSON.stringify(chunk);
            collectChatDebugFromSseEvent(`data: ${data}\n\n`, streamDebug);
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }

          usageSettled = true;
          await finalizeUsage(auth, usageSnapshot);
          agentDebugLog("chat.failover_stream_complete", {
            requestId,
            provider: "anthropic",
            usage: usageSnapshot,
            stream: streamDebug,
          });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          agentDebugLog("chat.failover_stream_error", {
            requestId,
            provider: "anthropic",
            error: error instanceof Error ? error.message : String(error),
          });
          console.error("[Stream Error] provider=anthropic failover:", error);
          if (!usageSettled) {
            usageSettled = true;
            await releaseReservedUsage(auth);
          }
          controller.error(error);
        }
      },
      cancel() {
        abortController.abort();
        // The client disconnected mid-stream; upstream tokens were still
        // consumed, so meter what we have observed so far.
        if (!usageSettled) {
          usageSettled = true;
          finalizeUsage(auth, usageSnapshot).catch(
            (error) =>
              console.error("[Usage] finalize-on-cancel failed:", error),
          );
        }
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const response = await anthropicFailoverClient.messages.create({
    ...requestParams,
    stream: false,
  });
  const openAiResponse = convertAnthropicResponseToOpenAI(response, model);

  await finalizeUsage(auth, response.usage);
  agentDebugLog("chat.failover_response", () => ({
    requestId,
    provider: "anthropic",
    response: summarizeChatCompletionResponse(openAiResponse),
  }));

  return new Response(JSON.stringify(openAiResponse), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function createAnthropicMessagesFailoverResponse(
  auth: AgentAuthContext,
  requestHeaders: Headers,
  body: Anthropic.Messages.MessageCreateParams,
): Promise<Response> {
  // The native Anthropic API has no top-level cache_control (unlike
  // OpenRouter), so add explicit breakpoints to keep prompt caching working
  // during failover.
  const anthropicBody = applyAnthropicNativePromptCaching({
    ...body,
    model: toAnthropicModelName(body.model),
    tool_choice: normalizeAnthropicToolChoiceAfterToolResult(body),
  });

  const abortController = new AbortController();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: getAnthropicHeaders(requestHeaders),
    body: JSON.stringify(anthropicBody),
    signal: abortController.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      "[Anthropic messages failover error]:",
      response.status,
      errorBody,
    );
    await releaseReservedUsage(auth);
    return new Response(errorBody, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
      },
    });
  }

  if (body.stream && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let usageSnapshot: Record<string, number> = {};
    let usageSettled = false;
    const readable = new ReadableStream({
      async start(controller) {
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const eventBlocks = buffer.split(/\r?\n\r?\n/);
            buffer = eventBlocks.pop() ?? "";
            for (const eventBlock of eventBlocks) {
              usageSnapshot = collectAnthropicUsageFromSseEvent(
                eventBlock,
                usageSnapshot,
              );
            }

            controller.enqueue(value);
          }

          buffer += decoder.decode();
          if (buffer.trim()) {
            usageSnapshot = collectAnthropicUsageFromSseEvent(
              buffer,
              usageSnapshot,
            );
          }

          usageSettled = true;
          await finalizeUsage(auth, usageSnapshot);
          controller.close();
        } catch (error) {
          console.error(
            "[Stream Error] provider=anthropic failover (messages):",
            error,
          );
          if (!usageSettled) {
            usageSettled = true;
            await releaseReservedUsage(auth);
          }
          controller.error(error);
        }
      },
      cancel() {
        abortController.abort();
        reader.cancel().catch(() => {});
        // The client disconnected mid-stream; upstream tokens were still
        // consumed, so meter what we have observed so far.
        if (!usageSettled) {
          usageSettled = true;
          finalizeUsage(auth, usageSnapshot).catch(
            (error) =>
              console.error("[Usage] finalize-on-cancel failed:", error),
          );
        }
      },
    });

    return new Response(readable, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "text/event-stream",
        "Cache-Control": response.headers.get("cache-control") || "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const responseBody = await response.text();
  let parsedResponse: { usage?: unknown } | null = null;

  try {
    parsedResponse = JSON.parse(responseBody) as { usage?: unknown };
  } catch {
    parsedResponse = null;
  }

  await finalizeUsage(auth, parsedResponse?.usage);
  return new Response(responseBody, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") || "application/json",
    },
  });
}

/**
 * POST /v1/agent/chat/completions
 * OpenAI-style agent endpoint using official SDKs
 */
router.post(
  "/agent/chat/completions",
  validateAgentRequest,
  validateAgentAuth,
  async (c) => {
    const auth = c.get("agentAuth") as AgentAuthContext;
    const requestId = crypto.randomUUID();

    try {
      const body = c.get("validatedBody") as AgentRequest;
      const {
        messages,
        model,
        stream,
        temperature,
        max_tokens,
        top_p,
        frequency_penalty,
        presence_penalty,
        reasoning_effort,
        tools,
        tool_choice,
      } = body;
      const hasToolResult = hasChatToolResult(messages);

      agentDebugLog("chat.request", () => ({
        requestId,
        model,
        stream: stream ?? false,
        hasToolResult,
        toolChoice: summarizeToolChoice(tool_choice),
        tools: summarizeTools(tools),
        messages: summarizeChatMessages(messages),
      }));

      // model is guaranteed to exist after validateAgentAuth middleware
      const clientResult = getClient(model);
      if ("error" in clientResult) {
        agentDebugLog("chat.provider_error", {
          requestId,
          error: clientResult.error,
        });
        await releaseReservedUsage(auth);
        return c.json(
          {
            error: {
              message: clientResult.error,
              type: "server_error",
              param: null,
              code: "missing_provider_key",
            },
          },
          500,
        );
      }

      // Use OpenRouter SDK for OpenRouter models
      if (clientResult.type === "openrouter") {
        const providerName = clientResult.providerName;
        const normalizedToolChoice = normalizeOpenRouterToolChoice(
          tool_choice,
          hasToolResult,
        );
        const openrouterBody = applyAutomaticPromptCaching({
          model,
          provider: getOpenRouterProviderRouting(model),
          messages,
          stream: stream ?? false,
          stream_options: stream ? { include_usage: true } : undefined,
          temperature: temperature ?? undefined,
          max_tokens: max_tokens ?? undefined,
          top_p: top_p ?? undefined,
          frequency_penalty: frequency_penalty ?? undefined,
          presence_penalty: presence_penalty ?? undefined,
          reasoning: reasoning_effort
            ? { effort: reasoning_effort }
            : undefined,
          tools: convertToolsToOpenRouter(tools),
          tool_choice: normalizedToolChoice,
        }, model);

        agentDebugLog("chat.upstream_request", () => ({
          requestId,
          provider: providerName,
          model,
          stream: openrouterBody.stream,
          toolChoice: summarizeToolChoice(normalizedToolChoice),
          tools: summarizeTools(openrouterBody.tools),
          messages: summarizeChatMessages(messages),
        }));

        const abortController = new AbortController();
        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Bun.env.OPENROUTER_API_KEY}`,
              "HTTP-Referer": "https://flixa.deniai.app",
              "X-OpenRouter-Title": "Deni AI Flixa",
              "X-OpenRouter-Categories": "cli-agent,ide-extension",
              "X-OpenRouter-Experimental-Metadata": "enabled",
            },
            body: JSON.stringify(openrouterBody),
            signal: abortController.signal,
          },
        );

        if (!response.ok) {
          const errorBody = await response.text();
          agentDebugLog("chat.upstream_error", {
            requestId,
            provider: providerName,
            status: response.status,
            contentType: response.headers.get("content-type"),
            bodyLength: errorBody.length,
          });

          if (shouldFailoverToAnthropic(response.status, model)) {
            agentDebugLog("chat.failover_start", {
              requestId,
              fromProvider: providerName,
              toProvider: "anthropic",
              status: response.status,
            });
            return await createAnthropicChatFailoverResponse(
              auth,
              requestId,
              body,
              hasToolResult,
            );
          }

          await releaseReservedUsage(auth);
          return new Response(errorBody, {
            status: response.status,
            headers: {
              "Content-Type":
                response.headers.get("content-type") || "application/json",
            },
          });
        }

        if (stream && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          const streamDebug = createChatStreamDebugSummary();
          let usageSnapshot: Record<string, number> = {};
          let usageSettled = false;

          const readable = new ReadableStream({
            async start(controller) {
              let buffer = "";

              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  buffer += decoder.decode(value, { stream: true });
                  const eventBlocks = buffer.split(/\r?\n\r?\n/);
                  buffer = eventBlocks.pop() ?? "";

                  for (const eventBlock of eventBlocks) {
                    usageSnapshot = collectChatUsageFromSseEvent(
                      eventBlock,
                      usageSnapshot,
                    );
                    collectChatDebugFromSseEvent(eventBlock, streamDebug);
                  }

                  controller.enqueue(value);
                }

                buffer += decoder.decode();
                if (buffer.trim()) {
                  usageSnapshot = collectChatUsageFromSseEvent(
                    buffer,
                    usageSnapshot,
                  );
                  collectChatDebugFromSseEvent(buffer, streamDebug);
                }

                usageSettled = true;
                await finalizeUsage(auth, usageSnapshot);
                agentDebugLog("chat.stream_complete", {
                  requestId,
                  provider: providerName,
                  usage: usageSnapshot,
                  stream: streamDebug,
                });
                controller.close();
              } catch (error) {
                agentDebugLog("chat.stream_error", {
                  requestId,
                  provider: providerName,
                  error: error instanceof Error ? error.message : String(error),
                });
                console.error(
                  `[Stream Error] provider=${providerName}:`,
                  error,
                );
                if (!usageSettled) {
                  usageSettled = true;
                  await releaseReservedUsage(auth);
                }
                controller.error(error);
              }
            },
            cancel() {
              abortController.abort();
              reader.cancel().catch(() => {});
              // The client disconnected mid-stream; upstream tokens were
              // still consumed, so meter what we have observed so far.
              if (!usageSettled) {
                usageSettled = true;
                finalizeUsage(auth, usageSnapshot).catch(
                  (error) =>
                    console.error("[Usage] finalize-on-cancel failed:", error),
                );
              }
            },
          });

          return new Response(readable, {
            status: response.status,
            headers: {
              "Content-Type":
                response.headers.get("content-type") || "text/event-stream",
              "Cache-Control":
                response.headers.get("cache-control") || "no-cache",
              Connection: "keep-alive",
            },
          });
        }

        const responseBody = await response.text();
        let parsedResponse: { usage?: unknown } | null = null;

        try {
          parsedResponse = JSON.parse(responseBody) as { usage?: unknown };
        } catch {
          parsedResponse = null;
        }

        await finalizeUsage(auth, parsedResponse?.usage);
        agentDebugLog("chat.response", () => ({
          requestId,
          provider: providerName,
          status: response.status,
          response: summarizeChatCompletionResponse(parsedResponse),
        }));
        return new Response(responseBody, {
          status: response.status,
          headers: {
            "Content-Type":
              response.headers.get("content-type") || "application/json",
          },
        });
      }

      // Use OpenAI SDK for voids.top (fallback)
      const { client, providerName } = clientResult;
      const normalizedToolChoice =
        tools && tools.length > 0
          ? normalizeOpenAIChatToolChoice(tool_choice, hasToolResult)
          : undefined;

      const requestParams:
        | OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
        | OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        model,
        messages,
        stream: stream ?? false,
        stream_options: stream ? { include_usage: true } : undefined,
        temperature,
        max_tokens,
        top_p,
        frequency_penalty,
        presence_penalty,
        reasoning_effort,
        tools: tools && tools.length > 0 ? tools : undefined,
        tool_choice: normalizedToolChoice,
      };

      agentDebugLog("chat.upstream_request", () => ({
        requestId,
        provider: providerName,
        model,
        stream: requestParams.stream,
        toolChoice: summarizeToolChoice(normalizedToolChoice),
        tools: summarizeTools(requestParams.tools),
        messages: summarizeChatMessages(messages),
      }));

      if (stream) {
        const abortController = new AbortController();
        const streamResponse = await client.chat.completions.create(
          {
            ...requestParams,
            stream: true,
          },
          {
            signal: abortController.signal,
          },
        );

        // Convert OpenAI stream to SSE Response
        const encoder = new TextEncoder();
        let usageSnapshot: Record<string, number> = {};
        let usageSettled = false;
        const readable = new ReadableStream({
          async start(controller) {
            const streamDebug = createChatStreamDebugSummary();

            try {
              for await (const chunk of streamResponse) {
                if (chunk.usage) {
                  usageSnapshot = mergeUsageSnapshot(
                    usageSnapshot,
                    chunk.usage,
                  );
                }
                const data = JSON.stringify(chunk);
                collectChatDebugFromSseEvent(`data: ${data}\n\n`, streamDebug);
                controller.enqueue(encoder.encode(`data: ${data}\n\n`));
              }
              usageSettled = true;
              await finalizeUsage(auth, usageSnapshot);
              agentDebugLog("chat.stream_complete", {
                requestId,
                provider: providerName,
                usage: usageSnapshot,
                stream: streamDebug,
              });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            } catch (error) {
              agentDebugLog("chat.stream_error", {
                requestId,
                provider: providerName,
                error: error instanceof Error ? error.message : String(error),
              });
              console.error(`[Stream Error] provider=${providerName}:`, error);
              if (!usageSettled) {
                usageSettled = true;
                await releaseReservedUsage(auth);
              }
              controller.error(error);
            }
          },
          cancel() {
            abortController.abort();
            // The client disconnected mid-stream; upstream tokens were still
            // consumed, so meter what we have observed so far.
            if (!usageSettled) {
              usageSettled = true;
              finalizeUsage(auth, usageSnapshot).catch((error) =>
                console.error("[Usage] finalize-on-cancel failed:", error),
              );
            }
          },
        });

        return new Response(readable, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      // Non-streaming request
      const response = await client.chat.completions.create({
        ...requestParams,
        stream: false,
      });

      await finalizeUsage(auth, response.usage);
      agentDebugLog("chat.response", () => ({
        requestId,
        provider: providerName,
        response: summarizeChatCompletionResponse(response),
      }));
      return c.json(response, 200);
    } catch (error) {
      await releaseReservedUsage(auth);
      agentDebugLog("chat.error", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error("Agent error:", error);

      if (error instanceof OpenAI.APIError) {
        const statusCode = (error.status || 500) as ContentfulStatusCode;
        return c.json(
          {
            error: {
              message: error.message,
              type: error.type || "api_error",
              param: null,
              code: error.code || null,
            },
          },
          statusCode,
        );
      }

      if (error instanceof Anthropic.APIError) {
        const statusCode = (error.status || 500) as ContentfulStatusCode;
        const apiError = error as {
          message: string;
          type?: string;
          code?: string | null;
        };
        return c.json(
          {
            error: {
              message: apiError.message,
              type: apiError.type || "api_error",
              param: null,
              code: apiError.code || null,
            },
          },
          statusCode,
        );
      }

      const err = error as Error;
      return c.json(
        {
          error: {
            message: err.message || "Internal server error",
            type: "server_error",
            param: null,
            code: null,
          },
        },
        500,
      );
    }
  },
);

/**
 * POST /v1/agent/responses
 * OpenAI Responses API compatible endpoint
 */
router.post(
  "/agent/responses",
  validateResponsesRequest,
  validateAgentAuth,
  async (c) => {
    const auth = c.get("agentAuth") as AgentAuthContext;

    try {
      const body = c.get("validatedBody") as ResponsesRequest;
      const clientResult = getClient(body.model);

      if ("error" in clientResult) {
        await releaseReservedUsage(auth);
        return c.json(
          {
            error: {
              message: clientResult.error,
              type: "server_error",
              param: null,
              code: "missing_provider_key",
            },
          },
          500,
        );
      }

      const url = getResponsesBaseUrl(clientResult);
      const headers = getResponsesHeaders(clientResult);
      const normalizedResponsesRequest = normalizeResponsesRequest(body);
      const providerRequest =
        clientResult.type === "openrouter"
          ? applyAutomaticPromptCaching(
              {
                ...normalizedResponsesRequest,
                provider: getOpenRouterProviderRouting(body.model),
              },
              body.model,
            )
          : normalizedResponsesRequest;

      const abortController = new AbortController();
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(providerRequest),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        await releaseReservedUsage(auth);
        return new Response(errorBody, {
          status: response.status,
          headers: {
            "Content-Type":
              response.headers.get("content-type") || "application/json",
          },
        });
      }

      if (body.stream && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let usageSnapshot: Record<string, number> = {};
        let usageSettled = false;

        const readable = new ReadableStream({
          async start(controller) {
            let buffer = "";

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const eventBlocks = buffer.split(/\r?\n\r?\n/);
                buffer = eventBlocks.pop() ?? "";

                for (const eventBlock of eventBlocks) {
                  usageSnapshot = collectResponsesUsageFromSseEvent(
                    eventBlock,
                    usageSnapshot,
                  );
                }

                controller.enqueue(value);
              }

              buffer += decoder.decode();
              if (buffer.trim()) {
                usageSnapshot = collectResponsesUsageFromSseEvent(
                  buffer,
                  usageSnapshot,
                );
              }

              usageSettled = true;
              await finalizeUsage(auth, usageSnapshot);
              controller.close();
            } catch (error) {
              if (!usageSettled) {
                usageSettled = true;
                await releaseReservedUsage(auth);
              }
              controller.error(error);
            }
          },
          cancel() {
            abortController.abort();
            reader.cancel().catch(() => {});
            // The client disconnected mid-stream; upstream tokens were still
            // consumed, so meter what we have observed so far.
            if (!usageSettled) {
              usageSettled = true;
              finalizeUsage(auth, usageSnapshot).catch(
                (error) =>
                  console.error("[Usage] finalize-on-cancel failed:", error),
              );
            }
          },
        });

        return new Response(readable, {
          status: response.status,
          headers: {
            "Content-Type":
              response.headers.get("content-type") || "text/event-stream",
            "Cache-Control":
              response.headers.get("cache-control") || "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      const responseBody = await response.text();
      let parsedResponse: { usage?: unknown } | null = null;

      try {
        parsedResponse = JSON.parse(responseBody) as { usage?: unknown };
      } catch {
        parsedResponse = null;
      }

      await finalizeUsage(auth, parsedResponse?.usage);
      return new Response(responseBody, {
        status: response.status,
        headers: {
          "Content-Type":
            response.headers.get("content-type") || "application/json",
        },
      });
    } catch (error) {
      await releaseReservedUsage(auth);
      console.error("Agent responses error:", error);

      if (error instanceof OpenAI.APIError) {
        const statusCode = (error.status || 500) as ContentfulStatusCode;
        return c.json(
          {
            error: {
              message: error.message,
              type: error.type || "api_error",
              param: null,
              code: error.code || null,
            },
          },
          statusCode,
        );
      }

      if (error instanceof Anthropic.APIError) {
        const statusCode = (error.status || 500) as ContentfulStatusCode;
        const apiError = error as {
          message: string;
          type?: string;
          code?: string | null;
        };
        return c.json(
          {
            error: {
              message: apiError.message,
              type: apiError.type || "api_error",
              param: null,
              code: apiError.code || null,
            },
          },
          statusCode,
        );
      }

      const err = error as Error;
      return c.json(
        {
          error: {
            message: err.message || "Internal server error",
            type: "server_error",
            param: null,
            code: null,
          },
        },
        500,
      );
    }
  },
);

/**
 * POST /v1/messages
 * Anthropic-compatible endpoint for Claude Code.
 * Routes through OpenRouter with Anthropic provider routing for BYOK traffic.
 */
router.post(
  "/messages",
  validateAnthropicRequest,
  validateAgentAuth,
  async (c) => {
    const auth = c.get("agentAuth") as AgentAuthContext;

    try {
      const body = c.get(
        "validatedBody",
      ) as Anthropic.Messages.MessageCreateParams;
      const { model, stream } = body;

      if (!Bun.env.OPENROUTER_API_KEY) {
        await releaseReservedUsage(auth);
        return c.json(
          {
            error: {
              message: "OPENROUTER_API_KEY is required for this endpoint",
              type: "server_error",
              param: null,
              code: "missing_provider_key",
            },
          },
          500,
        );
      }

      // Prefix model with anthropic/ for OpenRouter routing.
      const openRouterModel = model.startsWith("anthropic/")
        ? model
        : `anthropic/${model}`;

      const cachedFailoverState =
        getOpenRouterMessagesFailoverState(openRouterModel);
      if (
        cachedFailoverState &&
        isAnthropicModel(openRouterModel) &&
        hasAnthropicFailoverKey()
      ) {
        agentDebugLog("messages.failover_cache_hit", {
          provider: "openrouter",
          model: openRouterModel,
          status: cachedFailoverState.status,
          expiresAt: new Date(cachedFailoverState.expiresAt).toISOString(),
        });
        return await createAnthropicMessagesFailoverResponse(
          auth,
          c.req.raw.headers,
          body,
        );
      }

      // Pass through Anthropic format, but do not keep forcing tool use after a tool result.
      const openRouterBody = applyAutomaticPromptCaching({
        ...body,
        model: openRouterModel,
        provider: getOpenRouterProviderRouting(openRouterModel),
        tool_choice: normalizeAnthropicToolChoiceAfterToolResult(body),
      }, openRouterModel);

      const abortController = new AbortController();
      const response = await fetch("https://openrouter.ai/api/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Bun.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://flixa.deniai.app",
          "X-OpenRouter-Title": "Deni AI Flixa",
          "X-OpenRouter-Categories": "cli-agent,ide-extension",
          "X-OpenRouter-Experimental-Metadata": "enabled",
        },
        body: JSON.stringify(openRouterBody),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(
          "[OpenRouter messages error]:",
          response.status,
          errorBody,
        );

        if (shouldFailoverToAnthropic(response.status, openRouterModel)) {
          setOpenRouterMessagesFailoverState(openRouterModel, response.status);
          agentDebugLog("messages.failover_cache_set", {
            provider: "openrouter",
            model: openRouterModel,
            status: response.status,
            ttlMs: OPENROUTER_MESSAGES_FAILOVER_TTL_MS,
          });
          return await createAnthropicMessagesFailoverResponse(
            auth,
            c.req.raw.headers,
            body,
          );
        }

        await releaseReservedUsage(auth);
        return new Response(errorBody, {
          status: response.status,
          headers: {
            "Content-Type":
              response.headers.get("content-type") || "application/json",
          },
        });
      }

      clearOpenRouterMessagesFailoverState(openRouterModel);

      if (stream && response.body) {
        // Pipe the SSE stream directly from OpenRouter to the client.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let usageSnapshot: Record<string, number> = {};
        let usageSettled = false;
        const readable = new ReadableStream({
          async start(controller) {
            let buffer = "";

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const eventBlocks = buffer.split(/\r?\n\r?\n/);
                buffer = eventBlocks.pop() ?? "";
                for (const eventBlock of eventBlocks) {
                  usageSnapshot = collectAnthropicUsageFromSseEvent(
                    eventBlock,
                    usageSnapshot,
                  );
                }

                controller.enqueue(value);
              }

              buffer += decoder.decode();
              if (buffer.trim()) {
                usageSnapshot = collectAnthropicUsageFromSseEvent(
                  buffer,
                  usageSnapshot,
                );
              }

              usageSettled = true;
              await finalizeUsage(auth, usageSnapshot);
              controller.close();
            } catch (error) {
              console.error(
                "[Stream Error] provider=openrouter (messages):",
                error,
              );
              if (!usageSettled) {
                usageSettled = true;
                await releaseReservedUsage(auth);
              }
              controller.error(error);
            }
          },
          cancel() {
            abortController.abort();
            reader.cancel().catch(() => {});
            // The client disconnected mid-stream; upstream tokens were still
            // consumed, so meter what we have observed so far.
            if (!usageSettled) {
              usageSettled = true;
              finalizeUsage(auth, usageSnapshot).catch(
                (error) =>
                  console.error("[Usage] finalize-on-cancel failed:", error),
              );
            }
          },
        });

        return new Response(readable, {
          status: response.status,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      // Non-streaming: pass through the response directly
      const responseBody = await response.text();
      let parsedResponse: { usage?: unknown } | null = null;

      try {
        parsedResponse = JSON.parse(responseBody) as { usage?: unknown };
      } catch {
        parsedResponse = null;
      }

      await finalizeUsage(auth, parsedResponse?.usage);
      return new Response(responseBody, {
        status: response.status,
        headers: {
          "Content-Type":
            response.headers.get("content-type") || "application/json",
        },
      });
    } catch (error) {
      await releaseReservedUsage(auth);
      console.error("Anthropic endpoint error:", error);

      const err = error as Error;
      return c.json(
        {
          error: {
            message: err.message || "Internal server error",
            type: "server_error",
            param: null,
            code: null,
          },
        },
        500,
      );
    }
  },
);

export { router as agentRouter };
