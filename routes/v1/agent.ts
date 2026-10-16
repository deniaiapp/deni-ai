import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  validateAgentRequest,
  validateResponsesRequest,
  validateResponsesCompactRequest,
} from "../../middleware/validateRequest";
import { validateAnthropicRequest } from "../../middleware/validateAnthropicRequest";
import {
  validateAgentAuth,
  type AgentAuthContext,
} from "../../middleware/validateAgentAuth";
import {
  finalizeUsage,
  releaseReservedUsage,
} from "../../utils/agent/usageAccounting";
import {
  type AgentRequest,
  type ResponsesRequest,
  type ResponsesCompactRequest,
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
  convertResponsesToChatCompletion,
  convertResponsesStreamEventToChatChunks,
  convertResponsesUsageToChatUsage,
  normalizeResponsesInputItems,
  createResponsesToChatStreamState,
  applyResponsesBestPractices,
  isChatViaResponsesEnabled,
  isOpenAIFamilyModel,
  assertNoReservedCollaborationToolsInUpstreamBody,
  rewriteCollaborationNamesInChatPayload,
  rewriteCollaborationNamesInResponsesPayload,
  rewriteCollaborationNamesInSseEventBlock,
  sanitizeReservedCollaborationInResponsesRequest,
  toDeniResponsesRequest,
  type ResponsesProviderKind,
} from "../../utils/agent";
import {
  createUpstreamTimeout,
  type UpstreamTimeout,
} from "../../utils/agent/upstream";
import {
  publicErrorMessage,
  publicUpstreamErrorResponse,
} from "../../utils/agent/publicError";

const router = new Hono<{
  Variables: {
    validatedBody: AgentRequest | ResponsesRequest;
    agentAuth: AgentAuthContext;
  };
}>();

/**
 * GET /v1/agent
 *
 * Provider base URL compatibility probe. Hono dispatches HEAD requests to the
 * matching GET handler, so this also covers HEAD /v1/agent.
 */
router.get("/agent", (c) => {
  return c.json({ object: "agent", status: "ok" }, 200);
});

const anthropicFailoverClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
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
  const value = process.env.FLIXA_AGENT_DEBUG_LOGS?.toLowerCase();
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
  auth: AgentAuthContext,
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

    auth.usageEstimate?.observe(event);

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

type ResponsesClientResult = Extract<
  ReturnType<typeof getClient>,
  { type: "openrouter" | "openai" | "deni" }
>;

function getResponsesBaseUrl(clientResult: ResponsesClientResult): string {
  if (clientResult.type === "openrouter") {
    return "https://openrouter.ai/api/v1/responses";
  }

  return `${clientResult.client.baseURL}/responses`;
}

function getResponsesHeaders(
  clientResult: ResponsesClientResult,
): Record<string, string> {
  if (clientResult.type === "openrouter") {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://flixa.deniai.app",
      "X-OpenRouter-Title": "Deni AI Flixa",
      "X-OpenRouter-Categories": "cli-agent,ide-extension",
      "X-OpenRouter-Experimental-Metadata": "enabled",
    };
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${clientResult.client.apiKey ?? ""}`,
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
  return Boolean(process.env.ANTHROPIC_API_KEY);
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
    "x-api-key": process.env.ANTHROPIC_API_KEY || "",
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
    const input = normalizeResponsesInputItems(body.input);
    if (Array.isArray(input) && hasChatToolTranscript(input)) {
      return convertMessagesToResponsesInput(
        input as AgentRequest["messages"],
      );
    }

    return input;
  }

  if (body.messages !== undefined) {
    return convertMessagesToResponsesInput(body.messages);
  }

  return undefined;
}

function normalizeResponsesRequest(
  body: ResponsesRequest,
  provider: ResponsesProviderKind,
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

  // Codex uses these standard Responses fields to keep large histories
  // within the selected model's context window and to control prompt cache
  // behavior. Preserve them instead of silently dropping them at the proxy.
  if (body.truncation !== undefined) {
    normalized.truncation = body.truncation;
  }

  // These controls are OpenAI Responses options. Do not send them to
  // OpenRouter, whose Responses compatibility layer does not guarantee the
  // same provider-specific fields.
  if (provider === "openai") {
    if (body.service_tier !== undefined) {
      normalized.service_tier = body.service_tier;
    }
    if (body.prompt_cache_key !== undefined) {
      normalized.prompt_cache_key = body.prompt_cache_key;
    }
    if (body.prompt_cache_retention !== undefined) {
      normalized.prompt_cache_retention = body.prompt_cache_retention;
    }
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

  // null = explicitly disable; undefined = apply provider defaults.
  if (body.context_management !== undefined) {
    normalized.context_management = body.context_management;
  }

  const withBestPractices = applyResponsesBestPractices(normalized, provider);
  sanitizeReservedCollaborationInResponsesRequest(
    withBestPractices,
    body.model,
  );
  return withBestPractices;
}

/**
 * Build a Responses request from a Chat Completions body so OpenAI-style
 * agent traffic can use retained reasoning under the hood.
 */
function buildResponsesRequestFromChat(
  body: AgentRequest,
  provider: ResponsesProviderKind,
): Record<string, unknown> {
  const hasToolResult = hasChatToolResult(body.messages);
  const input = convertMessagesToResponsesInput(body.messages);
  const tools = normalizeResponsesTools(body.tools);
  const toolChoice =
    tools && tools.length > 0
      ? normalizeResponsesToolChoice(
          body.tool_choice as ResponsesRequest["tool_choice"],
          hasToolResult,
        )
      : undefined;

  const reasoning = body.reasoning_effort
    ? { effort: body.reasoning_effort }
    : undefined;

  const normalized: Record<string, unknown> = {
    model: body.model,
    input,
    stream: body.stream ?? false,
  };

  if (body.temperature !== undefined) {
    normalized.temperature = body.temperature;
  }
  if (body.top_p !== undefined) {
    normalized.top_p = body.top_p;
  }
  if (body.max_tokens !== undefined) {
    normalized.max_output_tokens = body.max_tokens;
  }
  if (reasoning !== undefined) {
    normalized.reasoning = reasoning;
  }
  if (tools !== undefined) {
    normalized.tools = tools;
  }
  if (toolChoice !== undefined) {
    normalized.tool_choice = toolChoice;
  }

  const withBestPractices = applyResponsesBestPractices(normalized, provider);
  sanitizeReservedCollaborationInResponsesRequest(
    withBestPractices,
    body.model,
  );
  return withBestPractices;
}

function shouldRouteChatViaResponses(model: string): boolean {
  // Prefer Responses for OpenAI family only — retained reasoning is
  // OpenAI-centric; keep other providers on Chat Completions.
  return (
    isChatViaResponsesEnabled() &&
    !isAnthropicModel(model) &&
    isOpenAIFamilyModel(model)
  );
}

function normalizeCompactRequest(
  body: ResponsesCompactRequest,
  provider: ResponsesProviderKind,
): Record<string, unknown> {
  const input =
    body.input !== undefined
      ? (() => {
          const normalizedInput = normalizeResponsesInputItems(body.input);
          return Array.isArray(normalizedInput) &&
            hasChatToolTranscript(normalizedInput)
            ? convertMessagesToResponsesInput(
                normalizedInput as AgentRequest["messages"],
              )
            : normalizedInput;
        })()
      : body.messages !== undefined
        ? convertMessagesToResponsesInput(body.messages)
        : undefined;

  const normalized: Record<string, unknown> = {
    model: body.model,
  };

  if (input !== undefined) {
    normalized.input = input;
  }
  if (body.instructions !== undefined) {
    normalized.instructions = body.instructions;
  }
  if (body.previous_response_id !== undefined) {
    normalized.previous_response_id = body.previous_response_id;
  }

  // Compact is always stateless / ZDR-friendly on our side.
  if (provider === "openrouter") {
    delete normalized.previous_response_id;
  }

  sanitizeReservedCollaborationInResponsesRequest(normalized, body.model);
  return normalized;
}

async function proxyResponsesUpstream(options: {
  auth: AgentAuthContext;
  requestId?: string;
  clientResult: ResponsesClientResult;
  providerRequest: Record<string, unknown>;
  stream: boolean;
  /** When true, convert Responses payload/stream back to Chat Completions. */
  asChatCompletion?: boolean;
  model: string;
}): Promise<Response> {
  const {
    auth,
    requestId,
    clientResult,
    providerRequest,
    stream,
    asChatCompletion,
    model,
  } = options;
  const providerName = clientResult.providerName;
  const url = getResponsesBaseUrl(clientResult);
  const headers = getResponsesHeaders(clientResult);

  const upstreamBody: Record<string, unknown> =
    clientResult.type === "openrouter"
      ? applyAutomaticPromptCaching(
          {
            ...providerRequest,
            provider: getOpenRouterProviderRouting(model),
          } as Record<string, unknown>,
          model,
        )
      : providerRequest;

  // Last-mile guard: Responses input items must be flat even when a provider
  // request was assembled by a compatibility path after normalization.
  if (upstreamBody.input !== undefined) {
    upstreamBody.input = normalizeResponsesInputItems(upstreamBody.input);
  }

  // Last-mile guard: the body sent below must never contain a client-defined
  // collaboration.* function schema reserved by the upstream model.
  assertNoReservedCollaborationToolsInUpstreamBody(upstreamBody, model);

  agentDebugLog("responses.upstream_request", () => ({
    requestId,
    provider: providerName,
    model,
    stream,
    asChatCompletion: asChatCompletion ?? false,
    hasContextManagement: upstreamBody.context_management !== undefined,
    store: upstreamBody.store,
    include: upstreamBody.include,
    reasoning: upstreamBody.reasoning,
  }));

  const upstreamTimeout = createUpstreamTimeout();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamBody),
      signal: upstreamTimeout.signal,
    });
    upstreamTimeout.refresh();
  } catch (error) {
    upstreamTimeout.dispose();
    throw error;
  }

  if (!response.ok) {
    const errorBody = await response.text();
    upstreamTimeout.dispose();
    agentDebugLog("responses.upstream_error", {
      requestId,
      provider: providerName,
      status: response.status,
      bodyLength: errorBody.length,
    });
    await releaseReservedUsage(auth);
    return publicUpstreamErrorResponse(response.status, errorBody);
  }

  if (stream && response.body) {
    if (asChatCompletion) {
      return createChatStreamFromResponsesUpstream(
        auth,
        requestId,
        providerName,
        model,
        response,
        upstreamTimeout,
      );
    }

    return createResponsesPassthroughStream(
      auth,
      response,
      upstreamTimeout,
    );
  }

  let responseBody: string;
  try {
    responseBody = await response.text();
  } finally {
    upstreamTimeout.dispose();
  }
  let parsedResponse: Record<string, unknown> | null = null;
  try {
    parsedResponse = JSON.parse(responseBody) as Record<string, unknown>;
  } catch {
    parsedResponse = null;
  }

  if (asChatCompletion) {
    const chatCompletion = rewriteCollaborationNamesInChatPayload(
      convertResponsesToChatCompletion(parsedResponse ?? {}, model),
    ) as Record<string, unknown>;
    await finalizeUsage(auth, chatCompletion.usage);
    agentDebugLog("chat.response_via_responses", () => ({
      requestId,
      provider: providerName,
      response: summarizeChatCompletionResponse(chatCompletion),
    }));
    return new Response(JSON.stringify(chatCompletion), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const clientFacing =
    parsedResponse !== null
      ? (rewriteCollaborationNamesInResponsesPayload(
          parsedResponse,
        ) as Record<string, unknown>)
      : null;
  await finalizeUsage(auth, clientFacing?.usage ?? parsedResponse?.usage);
  return new Response(
    clientFacing !== null ? JSON.stringify(clientFacing) : responseBody,
    {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
      },
    },
  );
}

function createResponsesPassthroughStream(
  auth: AgentAuthContext,
  response: Response,
  upstreamTimeout: UpstreamTimeout,
): Response {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let usageSnapshot: Record<string, number> = {};
  let usageSettled = false;
  let cancelled = false;

  const readable = new ReadableStream({
    async start(controller) {
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (cancelled) return;
          if (done) break;
          upstreamTimeout.refresh();

          buffer += decoder.decode(value, { stream: true });
          const eventBlocks = buffer.split(/\r?\n\r?\n/);
          buffer = eventBlocks.pop() ?? "";

          for (const eventBlock of eventBlocks) {
            usageSnapshot = collectResponsesUsageFromSseEvent(
              eventBlock,
              usageSnapshot,
              auth,
            );
            const clientFacingEvent = rewriteCollaborationNamesInSseEventBlock(
              eventBlock,
            );
            controller.enqueue(encoder.encode(`${clientFacingEvent}\n\n`));
          }
        }

        if (cancelled) return;
        buffer += decoder.decode();
        if (buffer.trim()) {
          usageSnapshot = collectResponsesUsageFromSseEvent(
            buffer,
            usageSnapshot,
            auth,
          );
          const clientFacingEvent = rewriteCollaborationNamesInSseEventBlock(
            buffer,
          );
          controller.enqueue(encoder.encode(clientFacingEvent));
        }

        usageSettled = true;
        await finalizeUsage(auth, usageSnapshot, false);
        upstreamTimeout.dispose();
        controller.close();
      } catch (error) {
        if (cancelled) return;
        upstreamTimeout.dispose();
        if (!usageSettled) {
          usageSettled = true;
          await finalizeUsage(auth, usageSnapshot, false);
        }
        controller.error(error);
      }
    },
    cancel() {
      cancelled = true;
      upstreamTimeout.abort();
      upstreamTimeout.dispose();
      reader.cancel().catch(() => {});
      if (!usageSettled) {
        usageSettled = true;
        return finalizeUsage(auth, usageSnapshot, false).catch((error) =>
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

function createChatStreamFromResponsesUpstream(
  auth: AgentAuthContext,
  requestId: string | undefined,
  providerName: string,
  model: string,
  response: Response,
  upstreamTimeout: UpstreamTimeout,
): Response {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const streamState = createResponsesToChatStreamState(model);
  const streamDebug = createChatStreamDebugSummary();
  let usageSnapshot: Record<string, number> = {};
  let usageSettled = false;
  let cancelled = false;
  let finished = false;

  const readable = new ReadableStream({
    async start(controller) {
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (cancelled) return;
          if (done) break;
          upstreamTimeout.refresh();

          buffer += decoder.decode(value, { stream: true });
          const eventBlocks = buffer.split(/\r?\n\r?\n/);
          buffer = eventBlocks.pop() ?? "";

          for (const eventBlock of eventBlocks) {
            const payload = eventBlock
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");

            if (!payload || payload === "[DONE]") {
              continue;
            }

            let event: unknown;
            try {
              event = JSON.parse(payload);
            } catch {
              continue;
            }

            usageSnapshot = collectResponsesUsageFromSseEvent(
              eventBlock,
              usageSnapshot,
              auth,
            );

            const chunks = convertResponsesStreamEventToChatChunks(
              event,
              streamState,
            );
            for (const rawChunk of chunks) {
              const chunk = rewriteCollaborationNamesInChatPayload(
                rawChunk,
              ) as Record<string, unknown>;
              const data = JSON.stringify(chunk);
              collectChatDebugFromSseEvent(`data: ${data}\n\n`, streamDebug);
              if (chunk.usage) {
                usageSnapshot = mergeUsageSnapshot(usageSnapshot, chunk.usage);
              }
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
              if (
                Array.isArray(chunk.choices) &&
                chunk.choices[0] &&
                typeof chunk.choices[0] === "object" &&
                (chunk.choices[0] as { finish_reason?: unknown })
                  .finish_reason
              ) {
                finished = true;
              }
            }
          }
        }

        if (cancelled) return;
        buffer += decoder.decode();
        if (buffer.trim()) {
          usageSnapshot = collectResponsesUsageFromSseEvent(
            buffer,
            usageSnapshot,
            auth,
          );
        }

        if (!finished) {
          const usage = convertResponsesUsageToChatUsage(usageSnapshot);
          const finalChunk = {
            id: streamState.id,
            object: "chat.completion.chunk",
            created: streamState.created,
            model: streamState.model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: streamState.finishReason ?? "stop",
                logprobs: null,
              },
            ],
            ...(usage ? { usage } : {}),
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`),
          );
        }

        usageSettled = true;
        await finalizeUsage(
          auth,
          streamState.usage ?? usageSnapshot,
          false,
        );
        upstreamTimeout.dispose();
        agentDebugLog("chat.stream_complete_via_responses", {
          requestId,
          provider: providerName,
          usage: streamState.usage ?? usageSnapshot,
          stream: streamDebug,
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        if (cancelled) return;
        upstreamTimeout.dispose();
        agentDebugLog("chat.stream_error_via_responses", {
          requestId,
          provider: providerName,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!usageSettled) {
          usageSettled = true;
          await finalizeUsage(auth, usageSnapshot, false);
        }
        controller.error(error);
      }
    },
    cancel() {
      cancelled = true;
      upstreamTimeout.abort();
      upstreamTimeout.dispose();
      reader.cancel().catch(() => {});
      if (!usageSettled) {
        usageSettled = true;
        return finalizeUsage(auth, streamState.usage ?? usageSnapshot, false).catch(
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

function collectResponsesUsageFromSseEvent(
  eventBlock: string,
  usageSnapshot: Record<string, number>,
  auth: AgentAuthContext,
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

    auth.usageEstimate?.observe(event);

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
  auth: AgentAuthContext,
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
    auth.usageEstimate?.observe(event);

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
    const upstreamTimeout = createUpstreamTimeout();
    let streamResponse: AsyncIterable<Anthropic.MessageStreamEvent>;
    try {
      streamResponse = await anthropicFailoverClient.messages.create(
        {
          ...requestParams,
          stream: true,
        },
        { signal: upstreamTimeout.signal },
      );
      upstreamTimeout.refresh();
    } catch (error) {
      upstreamTimeout.dispose();
      throw error;
    }

    const encoder = new TextEncoder();
    let usageSnapshot: Record<string, number> = {};
    let usageSettled = false;
    let cancelled = false;
    const readable = new ReadableStream({
      async start(controller) {
        let messageId = `chatcmpl_${requestId}`;
        const streamDebug = createChatStreamDebugSummary();

        try {
          for await (const event of streamResponse) {
            if (cancelled) return;
            upstreamTimeout.refresh();
            auth.usageEstimate?.observe(event);
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

          if (cancelled) return;
          usageSettled = true;
          await finalizeUsage(auth, usageSnapshot, false);
          upstreamTimeout.dispose();
          agentDebugLog("chat.failover_stream_complete", {
            requestId,
            provider: "anthropic",
            usage: usageSnapshot,
            stream: streamDebug,
          });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          if (cancelled) return;
          upstreamTimeout.dispose();
          agentDebugLog("chat.failover_stream_error", {
            requestId,
            provider: "anthropic",
            error: error instanceof Error ? error.message : String(error),
          });
          console.error("[Stream Error] provider=anthropic failover:", error);
          if (!usageSettled) {
            usageSettled = true;
            await finalizeUsage(auth, usageSnapshot, false);
          }
          controller.error(error);
        }
      },
      cancel() {
        cancelled = true;
        upstreamTimeout.abort();
        upstreamTimeout.dispose();
        // The client disconnected mid-stream; upstream tokens were still
        // consumed, so meter what we have observed so far.
        if (!usageSettled) {
          usageSettled = true;
          return finalizeUsage(auth, usageSnapshot, false).catch(
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

  const upstreamTimeout = createUpstreamTimeout();
  let response: Anthropic.Message;
  try {
    response = await anthropicFailoverClient.messages.create(
      {
        ...requestParams,
        stream: false,
      },
      { signal: upstreamTimeout.signal },
    );
    upstreamTimeout.refresh();
  } catch (error) {
    upstreamTimeout.dispose();
    throw error;
  }
  upstreamTimeout.dispose();
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

  const upstreamTimeout = createUpstreamTimeout();
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: getAnthropicHeaders(requestHeaders),
      body: JSON.stringify(anthropicBody),
      signal: upstreamTimeout.signal,
    });
    upstreamTimeout.refresh();
  } catch (error) {
    upstreamTimeout.dispose();
    throw error;
  }

  if (!response.ok) {
    const errorBody = await response.text();
    upstreamTimeout.dispose();
    console.error(
      "[Anthropic messages failover error]:",
      response.status,
      errorBody,
    );
    await releaseReservedUsage(auth);
    return publicUpstreamErrorResponse(response.status, errorBody);
  }

  if (body.stream && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let usageSnapshot: Record<string, number> = {};
    let usageSettled = false;
    let cancelled = false;
    const readable = new ReadableStream({
      async start(controller) {
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (cancelled) return;
            if (done) break;
            upstreamTimeout.refresh();

            buffer += decoder.decode(value, { stream: true });
            const eventBlocks = buffer.split(/\r?\n\r?\n/);
            buffer = eventBlocks.pop() ?? "";
            for (const eventBlock of eventBlocks) {
              usageSnapshot = collectAnthropicUsageFromSseEvent(
                eventBlock,
                usageSnapshot,
                auth,
              );
            }

            controller.enqueue(value);
          }

          buffer += decoder.decode();
          if (buffer.trim()) {
            usageSnapshot = collectAnthropicUsageFromSseEvent(
              buffer,
              usageSnapshot,
              auth,
            );
          }

          usageSettled = true;
          await finalizeUsage(auth, usageSnapshot, false);
          upstreamTimeout.dispose();
          controller.close();
        } catch (error) {
          if (cancelled) return;
          upstreamTimeout.dispose();
          console.error(
            "[Stream Error] provider=anthropic failover (messages):",
            error,
          );
          if (!usageSettled) {
            usageSettled = true;
            await finalizeUsage(auth, usageSnapshot, false);
          }
          controller.error(error);
        }
      },
      cancel() {
        cancelled = true;
        upstreamTimeout.abort();
        upstreamTimeout.dispose();
        reader.cancel().catch(() => {});
        // The client disconnected mid-stream; upstream tokens were still
        // consumed, so meter what we have observed so far.
        if (!usageSettled) {
          usageSettled = true;
          return finalizeUsage(auth, usageSnapshot, false).catch(
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

  let responseBody: string;
  try {
    responseBody = await response.text();
  } finally {
    upstreamTimeout.dispose();
  }
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
              message: "Internal server error",
              type: "server_error",
              param: null,
              code: "missing_provider_key",
            },
          },
          500,
        );
      }

      // OpenAI recommendation: prefer Responses API (retained reasoning)
      // for OpenAI-family models. Client-facing shape stays Chat Completions.
      // Deni AI API's /v1/responses drops reasoning settings, so Deni-routed
      // models stay on its /v1/chat/completions (forwarded as-is) below.
      if (
        shouldRouteChatViaResponses(model) &&
        (clientResult.type === "openrouter" || clientResult.type === "openai")
      ) {
        const provider: ResponsesProviderKind = clientResult.type;
        const responsesBody = buildResponsesRequestFromChat(body, provider);

        agentDebugLog("chat.via_responses", {
          requestId,
          provider: clientResult.providerName,
          model,
          stream: stream ?? false,
        });

        return await proxyResponsesUpstream({
          auth,
          requestId,
          clientResult,
          providerRequest: responsesBody,
          stream: stream ?? false,
          asChatCompletion: true,
          model,
        });
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
        assertNoReservedCollaborationToolsInUpstreamBody(
          openrouterBody as unknown as Record<string, unknown>,
          model,
        );

        agentDebugLog("chat.upstream_request", () => ({
          requestId,
          provider: providerName,
          model,
          stream: openrouterBody.stream,
          toolChoice: summarizeToolChoice(normalizedToolChoice),
          tools: summarizeTools(openrouterBody.tools),
          messages: summarizeChatMessages(messages),
        }));

        const upstreamTimeout = createUpstreamTimeout();
        let response: Response;
        try {
          response = await fetch(
            "https://openrouter.ai/api/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "HTTP-Referer": "https://flixa.deniai.app",
                "X-OpenRouter-Title": "Deni AI Flixa",
                "X-OpenRouter-Categories": "cli-agent,ide-extension",
                "X-OpenRouter-Experimental-Metadata": "enabled",
              },
              body: JSON.stringify(openrouterBody),
              signal: upstreamTimeout.signal,
            },
          );
          upstreamTimeout.refresh();
        } catch (error) {
          upstreamTimeout.dispose();
          throw error;
        }

        if (!response.ok) {
          const errorBody = await response.text();
          upstreamTimeout.dispose();
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
          return publicUpstreamErrorResponse(response.status, errorBody);
        }

        if (stream && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          const encoder = new TextEncoder();
          const streamDebug = createChatStreamDebugSummary();
          let usageSnapshot: Record<string, number> = {};
          let usageSettled = false;
          let cancelled = false;

          const readable = new ReadableStream({
            async start(controller) {
              let buffer = "";

              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (cancelled) return;
                  if (done) break;
                  upstreamTimeout.refresh();

                  buffer += decoder.decode(value, { stream: true });
                  const eventBlocks = buffer.split(/\r?\n\r?\n/);
                  buffer = eventBlocks.pop() ?? "";

                  for (const eventBlock of eventBlocks) {
                    const clientFacingEvent =
                      rewriteCollaborationNamesInSseEventBlock(eventBlock);
                    usageSnapshot = collectChatUsageFromSseEvent(
                      clientFacingEvent,
                      usageSnapshot,
                      auth,
                    );
                    collectChatDebugFromSseEvent(
                      clientFacingEvent,
                      streamDebug,
                    );
                    controller.enqueue(
                      encoder.encode(`${clientFacingEvent}\n\n`),
                    );
                  }
                }

                if (cancelled) return;
                buffer += decoder.decode();
                if (buffer.trim()) {
                  const clientFacingEvent =
                    rewriteCollaborationNamesInSseEventBlock(buffer);
                  usageSnapshot = collectChatUsageFromSseEvent(
                    clientFacingEvent,
                    usageSnapshot,
                    auth,
                  );
                  collectChatDebugFromSseEvent(
                    clientFacingEvent,
                    streamDebug,
                  );
                  controller.enqueue(encoder.encode(clientFacingEvent));
                }

                usageSettled = true;
                await finalizeUsage(auth, usageSnapshot, false);
                upstreamTimeout.dispose();
                agentDebugLog("chat.stream_complete", {
                  requestId,
                  provider: providerName,
                  usage: usageSnapshot,
                  stream: streamDebug,
                });
                controller.close();
              } catch (error) {
                if (cancelled) return;
                upstreamTimeout.dispose();
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
                  await finalizeUsage(auth, usageSnapshot, false);
                }
                controller.error(error);
              }
            },
            cancel() {
              cancelled = true;
              upstreamTimeout.abort();
              upstreamTimeout.dispose();
              reader.cancel().catch(() => {});
              // The client disconnected mid-stream; upstream tokens were
              // still consumed, so meter what we have observed so far.
              if (!usageSettled) {
                usageSettled = true;
                return finalizeUsage(auth, usageSnapshot, false).catch(
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

        let responseBody: string;
        try {
          responseBody = await response.text();
        } finally {
          upstreamTimeout.dispose();
        }
        let parsedResponse: Record<string, unknown> | null = null;

        try {
          parsedResponse = JSON.parse(responseBody) as Record<string, unknown>;
        } catch {
          parsedResponse = null;
        }

        const clientFacing =
          parsedResponse !== null
            ? (rewriteCollaborationNamesInChatPayload(
                parsedResponse,
              ) as Record<string, unknown>)
            : null;
        await finalizeUsage(auth, clientFacing?.usage ?? parsedResponse?.usage);
        agentDebugLog("chat.response", () => ({
          requestId,
          provider: providerName,
          status: response.status,
          response: summarizeChatCompletionResponse(clientFacing ?? parsedResponse),
        }));
        return new Response(
          clientFacing !== null ? JSON.stringify(clientFacing) : responseBody,
          {
            status: response.status,
            headers: {
              "Content-Type":
                response.headers.get("content-type") || "application/json",
            },
          },
        );
      }

      // Use OpenAI SDK for Deni AI API / voids.top (fallback)
      const { client, providerName } = clientResult;
      const normalizedToolChoice =
        tools && tools.length > 0
          ? normalizeOpenAIChatToolChoice(tool_choice, hasToolResult)
          : undefined;

      // OpenAI SDK types lag newer effort value (`max`); pass through as-is.
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
        reasoning_effort: reasoning_effort as
          | OpenAI.ReasoningEffort
          | undefined,
        tools: tools && tools.length > 0 ? tools : undefined,
        tool_choice: normalizedToolChoice,
      };

      assertNoReservedCollaborationToolsInUpstreamBody(
        requestParams as unknown as Record<string, unknown>,
        model,
      );

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
        const upstreamTimeout = createUpstreamTimeout();
        let streamResponse: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
        try {
          streamResponse = await client.chat.completions.create(
            {
              ...requestParams,
              stream: true,
            },
            {
              signal: upstreamTimeout.signal,
            },
          );
          upstreamTimeout.refresh();
        } catch (error) {
          upstreamTimeout.dispose();
          throw error;
        }

        // Convert OpenAI stream to SSE Response
        const encoder = new TextEncoder();
        let usageSnapshot: Record<string, number> = {};
        let usageSettled = false;
        let cancelled = false;
        const readable = new ReadableStream({
          async start(controller) {
            const streamDebug = createChatStreamDebugSummary();

            try {
              for await (const chunk of streamResponse) {
                if (cancelled) return;
                upstreamTimeout.refresh();
                auth.usageEstimate?.observe(chunk);
                const clientFacingChunk = rewriteCollaborationNamesInChatPayload(
                  chunk,
                ) as typeof chunk;
                if (clientFacingChunk.usage) {
                  usageSnapshot = mergeUsageSnapshot(
                    usageSnapshot,
                    clientFacingChunk.usage,
                  );
                }
                const data = JSON.stringify(clientFacingChunk);
                collectChatDebugFromSseEvent(`data: ${data}\n\n`, streamDebug);
                controller.enqueue(encoder.encode(`data: ${data}\n\n`));
              }
              if (cancelled) return;
              usageSettled = true;
              await finalizeUsage(auth, usageSnapshot, false);
              upstreamTimeout.dispose();
              agentDebugLog("chat.stream_complete", {
                requestId,
                provider: providerName,
                usage: usageSnapshot,
                stream: streamDebug,
              });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            } catch (error) {
              if (cancelled) return;
              upstreamTimeout.dispose();
              agentDebugLog("chat.stream_error", {
                requestId,
                provider: providerName,
                error: error instanceof Error ? error.message : String(error),
              });
              console.error(`[Stream Error] provider=${providerName}:`, error);
              if (!usageSettled) {
                usageSettled = true;
                await finalizeUsage(auth, usageSnapshot, false);
              }
              controller.error(error);
            }
          },
          cancel() {
            cancelled = true;
            upstreamTimeout.abort();
            upstreamTimeout.dispose();
            // The client disconnected mid-stream; upstream tokens were still
            // consumed, so meter what we have observed so far.
            if (!usageSettled) {
              usageSettled = true;
              return finalizeUsage(auth, usageSnapshot, false).catch((error) =>
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
      const upstreamTimeout = createUpstreamTimeout();
      let response: OpenAI.Chat.Completions.ChatCompletion;
      try {
        response = await client.chat.completions.create(
          {
            ...requestParams,
            stream: false,
          },
          { signal: upstreamTimeout.signal },
        );
        upstreamTimeout.refresh();
      } catch (error) {
        upstreamTimeout.dispose();
        throw error;
      }
      upstreamTimeout.dispose();
      const clientFacingResponse = rewriteCollaborationNamesInChatPayload(
        response,
      ) as typeof response;

      await finalizeUsage(auth, clientFacingResponse.usage);
      agentDebugLog("chat.response", () => ({
        requestId,
        provider: providerName,
        response: summarizeChatCompletionResponse(clientFacingResponse),
      }));
      return c.json(clientFacingResponse, 200);
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
              message: publicErrorMessage(statusCode),
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
          type?: string;
          code?: string | null;
        };
        return c.json(
          {
            error: {
              message: publicErrorMessage(statusCode),
              type: apiError.type || "api_error",
              param: null,
              code: apiError.code || null,
            },
          },
          statusCode,
        );
      }
      return c.json(
        {
          error: {
            message: "Internal server error",
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
 * OpenAI Responses API compatible endpoint with retained reasoning defaults.
 * Compaction is client-driven via POST /agent/responses/compact.
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
              message: "Internal server error",
              type: "server_error",
              param: null,
              code: "missing_provider_key",
            },
          },
          500,
        );
      }

      if (clientResult.type === "deni") {
        return await proxyResponsesUpstream({
          auth,
          clientResult,
          providerRequest: toDeniResponsesRequest(
            normalizeResponsesRequest(body, "openai"),
          ),
          stream: body.stream ?? false,
          model: body.model,
        });
      }

      if (clientResult.type !== "openrouter" && clientResult.type !== "openai") {
        await releaseReservedUsage(auth);
        return c.json(
          {
            error: {
              message: "Internal server error",
              type: "server_error",
              param: null,
              code: "unsupported_provider",
            },
          },
          500,
        );
      }

      const provider: ResponsesProviderKind = clientResult.type;
      const normalizedResponsesRequest = normalizeResponsesRequest(
        body,
        provider,
      );

      return await proxyResponsesUpstream({
        auth,
        clientResult,
        providerRequest: normalizedResponsesRequest,
        stream: body.stream ?? false,
        model: body.model,
      });
    } catch (error) {
      await releaseReservedUsage(auth);
      console.error("Agent responses error:", error);

      if (error instanceof OpenAI.APIError) {
        const statusCode = (error.status || 500) as ContentfulStatusCode;
        return c.json(
          {
            error: {
              message: publicErrorMessage(statusCode),
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
          type?: string;
          code?: string | null;
        };
        return c.json(
          {
            error: {
              message: publicErrorMessage(statusCode),
              type: apiError.type || "api_error",
              param: null,
              code: apiError.code || null,
            },
          },
          statusCode,
        );
      }
      return c.json(
        {
          error: {
            message: "Internal server error",
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
 * POST /v1/agent/responses/compact
 * Standalone compaction for long-running agent context windows.
 * Returns a compacted window (including encrypted compaction item) for the
 * next /responses call. See OpenAI compaction guide.
 */
router.post(
  "/agent/responses/compact",
  validateResponsesCompactRequest,
  validateAgentAuth,
  async (c) => {
    const auth = c.get("agentAuth") as AgentAuthContext;

    try {
      const body = c.get("validatedBody") as ResponsesCompactRequest;
      const clientResult = getClient(body.model);

      if ("error" in clientResult) {
        await releaseReservedUsage(auth);
        return c.json(
          {
            error: {
              message: "Internal server error",
              type: "server_error",
              param: null,
              code: "missing_provider_key",
            },
          },
          500,
        );
      }

      // Deni AI API has no /v1/responses/compact. 400 (not 5xx) so clients
      // do not retry and can fall back to local compaction.
      if (clientResult.type === "deni") {
        await releaseReservedUsage(auth);
        return c.json(
          {
            error: {
              message:
                "Responses compaction is not available for this model. Use client-side compaction.",
              type: "invalid_request_error",
              param: "model",
              code: "unsupported_model",
            },
          },
          400,
        );
      }

      if (clientResult.type !== "openrouter" && clientResult.type !== "openai") {
        await releaseReservedUsage(auth);
        return c.json(
          {
            error: {
              message: "Internal server error",
              type: "server_error",
              param: null,
              code: "unsupported_provider",
            },
          },
          500,
        );
      }

      const provider: ResponsesProviderKind = clientResult.type;
      const compactBody = normalizeCompactRequest(body, provider);
      // Upstream paths are .../responses → .../responses/compact
      const compactUrl = `${getResponsesBaseUrl(clientResult)}/compact`;
      const headers = getResponsesHeaders(clientResult);

      const upstreamTimeout = createUpstreamTimeout();
      let response: Response;
      try {
        response = await fetch(compactUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(compactBody),
          signal: upstreamTimeout.signal,
        });
        upstreamTimeout.refresh();
      } catch (error) {
        upstreamTimeout.dispose();
        throw error;
      }

      if (!response.ok) {
        const errorBody = await response.text();
        upstreamTimeout.dispose();
        await releaseReservedUsage(auth);
        return publicUpstreamErrorResponse(response.status, errorBody);
      }

      let responseBody: string;
      try {
        responseBody = await response.text();
      } finally {
        upstreamTimeout.dispose();
      }
      let parsedResponse: Record<string, unknown> | null = null;
      try {
        parsedResponse = JSON.parse(responseBody) as Record<string, unknown>;
      } catch {
        parsedResponse = null;
      }

      const clientFacing =
        parsedResponse !== null
          ? (rewriteCollaborationNamesInResponsesPayload(
              parsedResponse,
            ) as Record<string, unknown>)
          : null;
      await finalizeUsage(auth, clientFacing?.usage ?? parsedResponse?.usage);
      return new Response(
        clientFacing !== null ? JSON.stringify(clientFacing) : responseBody,
        {
          status: response.status,
          headers: {
            "Content-Type":
              response.headers.get("content-type") || "application/json",
          },
        },
      );
    } catch (error) {
      await releaseReservedUsage(auth);
      console.error("Agent responses compact error:", error);
      return c.json(
        {
          error: {
            message: "Internal server error",
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
 *
 * Aliases for clients that nest Anthropic paths under an agent base URL:
 *   POST /v1/agent/messages
 *   POST /v1/agent/v1/messages
 */
for (const messagesPath of [
  "/messages",
  "/agent/messages",
  "/agent/v1/messages",
] as const) {
router.post(
  messagesPath,
  validateAnthropicRequest,
  validateAgentAuth,
  async (c) => {
    const auth = c.get("agentAuth") as AgentAuthContext;

    try {
      const body = c.get(
        "validatedBody",
      ) as Anthropic.Messages.MessageCreateParams;
      const { model, stream } = body;

      if (!process.env.OPENROUTER_API_KEY) {
        await releaseReservedUsage(auth);
        return c.json(
          {
            error: {
              message: "Internal server error",
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

      const upstreamTimeout = createUpstreamTimeout();
      let response: Response;
      try {
        response = await fetch("https://openrouter.ai/api/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "HTTP-Referer": "https://flixa.deniai.app",
            "X-OpenRouter-Title": "Deni AI Flixa",
            "X-OpenRouter-Categories": "cli-agent,ide-extension",
            "X-OpenRouter-Experimental-Metadata": "enabled",
          },
          body: JSON.stringify(openRouterBody),
          signal: upstreamTimeout.signal,
        });
        upstreamTimeout.refresh();
      } catch (error) {
        upstreamTimeout.dispose();
        throw error;
      }

      if (!response.ok) {
        const errorBody = await response.text();
        upstreamTimeout.dispose();
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
        return publicUpstreamErrorResponse(response.status, errorBody);
      }

      clearOpenRouterMessagesFailoverState(openRouterModel);

      if (stream && response.body) {
        // Pipe the SSE stream directly from OpenRouter to the client.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let usageSnapshot: Record<string, number> = {};
        let usageSettled = false;
        let cancelled = false;
        const readable = new ReadableStream({
          async start(controller) {
            let buffer = "";

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (cancelled) return;
                if (done) break;
                upstreamTimeout.refresh();

                buffer += decoder.decode(value, { stream: true });
                const eventBlocks = buffer.split(/\r?\n\r?\n/);
                buffer = eventBlocks.pop() ?? "";
                for (const eventBlock of eventBlocks) {
                  usageSnapshot = collectAnthropicUsageFromSseEvent(
                    eventBlock,
                    usageSnapshot,
                    auth,
                  );
                }

                controller.enqueue(value);
              }

              if (cancelled) return;
              buffer += decoder.decode();
              if (buffer.trim()) {
                usageSnapshot = collectAnthropicUsageFromSseEvent(
                  buffer,
                  usageSnapshot,
                  auth,
                );
              }

              usageSettled = true;
              await finalizeUsage(auth, usageSnapshot, false);
              upstreamTimeout.dispose();
              controller.close();
            } catch (error) {
              if (cancelled) return;
              upstreamTimeout.dispose();
              console.error(
                "[Stream Error] provider=openrouter (messages):",
                error,
              );
              if (!usageSettled) {
                usageSettled = true;
                await finalizeUsage(auth, usageSnapshot, false);
              }
              controller.error(error);
            }
          },
          cancel() {
            cancelled = true;
            upstreamTimeout.abort();
            upstreamTimeout.dispose();
            reader.cancel().catch(() => {});
            // The client disconnected mid-stream; upstream tokens were still
            // consumed, so meter what we have observed so far.
            if (!usageSettled) {
              usageSettled = true;
              return finalizeUsage(auth, usageSnapshot, false).catch(
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
      let responseBody: string;
      try {
        responseBody = await response.text();
      } finally {
        upstreamTimeout.dispose();
      }
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
      return c.json(
        {
          error: {
            message: "Internal server error",
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
}

export { router as agentRouter };
