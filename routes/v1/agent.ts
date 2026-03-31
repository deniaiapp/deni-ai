import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ChatGenerationParams } from "@openrouter/sdk/models";
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
  cacheResponsesState,
  collectCompletedResponseFromSseEvent,
  getClient,
  convertMessagesToOpenRouter,
  convertToolsToOpenRouter,
  convertOpenRouterResponseToOpenAI,
  convertOpenRouterStreamChunkToOpenAI,
  resolveResponsesRequestState,
} from "../../utils/agent";

const router = new Hono<{
  Variables: {
    validatedBody: AgentRequest | ResponsesRequest;
    agentAuth: AgentAuthContext;
  };
}>();

function getNumericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractTotalTokens(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const usageRecord = usage as Record<string, unknown>;
  const explicitTotal =
    getNumericValue(usageRecord.total_tokens) ??
    getNumericValue(usageRecord.totalTokens);
  if (explicitTotal !== null) {
    return explicitTotal;
  }

  const promptTokens =
    getNumericValue(usageRecord.prompt_tokens) ??
    getNumericValue(usageRecord.promptTokens) ??
    getNumericValue(usageRecord.input_tokens) ??
    getNumericValue(usageRecord.inputTokens) ??
    0;
  const completionTokens =
    getNumericValue(usageRecord.completion_tokens) ??
    getNumericValue(usageRecord.completionTokens) ??
    getNumericValue(usageRecord.output_tokens) ??
    getNumericValue(usageRecord.outputTokens) ??
    0;
  const cacheCreationTokens =
    getNumericValue(usageRecord.cache_creation_input_tokens) ??
    getNumericValue(usageRecord.cacheCreationInputTokens) ??
    0;
  const cacheReadTokens =
    getNumericValue(usageRecord.cache_read_input_tokens) ??
    getNumericValue(usageRecord.cacheReadInputTokens) ??
    0;

  const total =
    promptTokens + completionTokens + cacheCreationTokens + cacheReadTokens;
  return total > 0 ? total : null;
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
    }
  }

  return next;
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
      "X-Title": "Deni AI Flixa",
    };
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${Bun.env.OPENAI_COMPAT_API_KEY || "a"}`,
  };
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
): unknown {
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
): ChatGenerationParams["toolChoice"] | undefined {
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

function normalizeResponsesInput(body: ResponsesRequest): unknown {
  if (body.input !== undefined) {
    return body.input;
  }

  if (body.messages !== undefined) {
    return body.messages;
  }

  return undefined;
}

function normalizeResponsesRequest(
  body: ResponsesRequest,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    model: body.model,
    input: normalizeResponsesInput(body),
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
    normalized.tool_choice = normalizeResponsesToolChoice(body.tool_choice);
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

async function finalizeUsage(
  auth: AgentAuthContext | undefined,
  totalTokens?: number | null,
): Promise<void> {
  if (!auth) return;

  auth.usageReserved = false;

  if (
    auth.usageUnit !== "tokens" ||
    totalTokens === null ||
    totalTokens === undefined ||
    totalTokens <= 0
  ) {
    return;
  }

  try {
    await recordUsageQuota(
      auth.userId,
      auth.modelCategory,
      auth.tier,
      totalTokens,
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

      // model is guaranteed to exist after validateAgentAuth middleware
      const clientResult = getClient(model);
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

      // Use OpenRouter SDK for OpenRouter models
      if (clientResult.type === "openrouter") {
        const { client, providerName } = clientResult;

        const openrouterParams: ChatGenerationParams = {
          model,
          messages: convertMessagesToOpenRouter(messages),
          stream: stream ?? false,
          streamOptions: stream ? { includeUsage: true } : undefined,
          temperature: temperature ?? undefined,
          maxTokens: max_tokens ?? undefined,
          topP: top_p ?? undefined,
          frequencyPenalty: frequency_penalty ?? undefined,
          presencePenalty: presence_penalty ?? undefined,
          reasoning: reasoning_effort
            ? { effort: reasoning_effort }
            : undefined,
          tools: convertToolsToOpenRouter(tools),
          toolChoice: normalizeOpenRouterToolChoice(tool_choice),
        };

        if (stream) {
          const abortController = new AbortController();
          const streamResponse = await client.chat.send(
            {
              chatGenerationParams: { ...openrouterParams, stream: true },
            },
            {
              signal: abortController.signal,
            },
          );

          // Convert OpenRouter stream to SSE Response
          const encoder = new TextEncoder();
          const readable = new ReadableStream({
            async start(controller) {
              let streamedTokens: number | null = null;

              try {
                for await (const chunk of streamResponse) {
                  streamedTokens =
                    extractTotalTokens(chunk.usage) ?? streamedTokens;
                  const converted = convertOpenRouterStreamChunkToOpenAI(chunk);
                  const data = JSON.stringify(converted);
                  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                }
                await finalizeUsage(auth, streamedTokens);
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              } catch (error) {
                console.error(
                  `[Stream Error] provider=${providerName}:`,
                  error,
                );
                await releaseReservedUsage(auth);
                controller.error(error);
              }
            },
            cancel() {
              abortController.abort();
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
        const response = await client.chat.send({
          chatGenerationParams: { ...openrouterParams, stream: false },
        });

        await finalizeUsage(auth, extractTotalTokens(response.usage));
        return c.json(convertOpenRouterResponseToOpenAI(response), 200);
      }

      // Use OpenAI SDK for voids.top (fallback)
      const { client, providerName } = clientResult;

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
        tool_choice: tools && tools.length > 0 ? tool_choice : undefined,
      };

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
        const readable = new ReadableStream({
          async start(controller) {
            let streamedTokens: number | null = null;

            try {
              for await (const chunk of streamResponse) {
                streamedTokens =
                  extractTotalTokens(chunk.usage) ?? streamedTokens;
                const data = JSON.stringify(chunk);
                controller.enqueue(encoder.encode(`data: ${data}\n\n`));
              }
              await finalizeUsage(auth, streamedTokens);
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            } catch (error) {
              console.error(`[Stream Error] provider=${providerName}:`, error);
              await releaseReservedUsage(auth);
              controller.error(error);
            }
          },
          cancel() {
            abortController.abort();
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

      await finalizeUsage(auth, extractTotalTokens(response.usage));
      return c.json(response, 200);
    } catch (error) {
      await releaseReservedUsage(auth);
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
      const normalizedBody = normalizeResponsesRequest(body);
      const providerRequest = resolveResponsesRequestState(normalizedBody);

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

        const readable = new ReadableStream({
          async start(controller) {
            let buffer = "";
            let usageSnapshot: Record<string, number> = {};
            let completedResponse: unknown = null;

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
                  completedResponse = collectCompletedResponseFromSseEvent(
                    eventBlock,
                    completedResponse,
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
                completedResponse = collectCompletedResponseFromSseEvent(
                  buffer,
                  completedResponse,
                );
              }

              await finalizeUsage(auth, extractTotalTokens(usageSnapshot));
              if (completedResponse) {
                cacheResponsesState(providerRequest, completedResponse);
              }
              controller.close();
            } catch (error) {
              await releaseReservedUsage(auth);
              controller.error(error);
            }
          },
          cancel() {
            abortController.abort();
            reader.cancel().catch(() => {});
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

      await finalizeUsage(auth, extractTotalTokens(parsedResponse?.usage));
      if (parsedResponse) {
        cacheResponsesState(providerRequest, parsedResponse);
      }
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
 * Routes through OpenRouter: Anthropic request → OpenRouter → Anthropic response
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

      // Prefix model with anthropic/ for OpenRouter routing
      const openRouterModel = model.startsWith("anthropic/")
        ? model
        : `anthropic/${model}`;

      // Pass the Anthropic request body directly to OpenRouter's Anthropic-compatible endpoint
      const openRouterBody = { ...body, model: openRouterModel };

      const abortController = new AbortController();
      const response = await fetch("https://openrouter.ai/api/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Bun.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://flixa.deniai.app",
          "X-Title": "Deni AI Flixa",
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
        await releaseReservedUsage(auth);
        return new Response(errorBody, {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (stream && response.body) {
        // Pipe the SSE stream directly from OpenRouter to the client
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const readable = new ReadableStream({
          async start(controller) {
            let buffer = "";
            let usageSnapshot: Record<string, number> = {};

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

              await finalizeUsage(auth, extractTotalTokens(usageSnapshot));
              controller.close();
            } catch (error) {
              console.error(
                "[Stream Error] provider=openrouter (messages):",
                error,
              );
              await releaseReservedUsage(auth);
              controller.error(error);
            }
          },
          cancel() {
            abortController.abort();
            reader.cancel().catch(() => {});
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

      await finalizeUsage(auth, extractTotalTokens(parsedResponse?.usage));
      return new Response(responseBody, {
        status: response.status,
        headers: { "Content-Type": "application/json" },
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
