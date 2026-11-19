import { z } from "zod";
import { reasoningEffortSchema } from "./models.js";

/**
 * Request bodies of the agent API inference routes: the subset of fields the
 * server validates (services/agent-api `middleware/validateRequest.ts` and
 * `validateAnthropicRequest.ts`). Unlisted fields pass through to the upstream
 * provider, so every schema is loose. A body that parses here can still be
 * rejected by checks that need server state: an unknown `model` (404
 * `model_not_found`), plan restrictions, and the server-tool policy
 * (`invalid_tool` for tools that select or run another model or use shared
 * server-side storage).
 */

const modelIdSchema = z.string().min(1);

const temperatureSchema = z.number().min(0).max(2);
const topPSchema = z.number().min(0).max(1);
const penaltySchema = z.number().min(-2).max(2);
const positiveIntSchema = z.number().int().positive();

export const chatMessageRoleSchema = z.enum(["system", "developer", "user", "assistant", "tool"]);

/** `content` is required except on assistant messages; tool messages need `tool_call_id`. */
export const chatMessageSchema = z
  .looseObject({
    role: chatMessageRoleSchema,
    content: z.unknown().optional(),
    tool_call_id: z.string().optional(),
  })
  .superRefine((message, ctx) => {
    if (message.role === "tool" && typeof message.tool_call_id !== "string") {
      ctx.addIssue({ code: "custom", message: "tool messages need tool_call_id" });
    }
    if (message.content === undefined && message.role !== "assistant") {
      ctx.addIssue({ code: "custom", message: "content is required", path: ["content"] });
    }
  });

export const chatFunctionToolSchema = z.looseObject({
  type: z.literal("function"),
  function: z.looseObject({ name: z.string() }),
});

/** `POST /v1/agent/chat/completions` (OpenAI Chat Completions). */
export const chatCompletionsRequestSchema = z.looseObject({
  model: modelIdSchema,
  messages: z.array(chatMessageSchema).min(1),
  temperature: temperatureSchema.optional(),
  top_p: topPSchema.optional(),
  frequency_penalty: penaltySchema.optional(),
  presence_penalty: penaltySchema.optional(),
  max_tokens: positiveIntSchema.optional(),
  tools: z.array(chatFunctionToolSchema).optional(),
  stream: z.boolean().optional(),
  reasoning_effort: reasoningEffortSchema.optional(),
});
export type ChatCompletionsRequest = z.infer<typeof chatCompletionsRequestSchema>;

/**
 * Responses tools: any `type`; `function` tools need a name, either directly
 * (`name`) or Chat-style (`function.name`).
 */
export const responsesToolSchema = z.looseObject({ type: z.string() }).superRefine((tool, ctx) => {
  if (tool.type !== "function") return;
  const record = tool as Record<string, unknown>;
  const wrapped = record.function;
  const wrappedName =
    typeof wrapped === "object" && wrapped !== null
      ? (wrapped as Record<string, unknown>).name
      : undefined;
  if (typeof record.name !== "string" && typeof wrappedName !== "string") {
    ctx.addIssue({ code: "custom", message: "function tools need a string name" });
  }
});

export const responsesToolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z.looseObject({ type: z.literal("function"), name: z.string() }),
  z.looseObject({ type: z.literal("function"), function: z.looseObject({ name: z.string() }) }),
  z.looseObject({
    type: z.string().refine((type) => type !== "function"),
  }),
]);

export const responsesReasoningSchema = z.looseObject({
  effort: reasoningEffortSchema.optional(),
  summary: z.enum(["auto", "concise", "detailed"]).optional(),
  context: z.enum(["auto", "current_turn", "all_turns"]).optional(),
  /** `pro` requests Pro mode where the model supports it. */
  mode: z.enum(["standard", "pro"]).optional(),
});

export const responsesTextFormatSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("text") }),
  z.looseObject({ type: z.literal("json_object") }),
  z.looseObject({
    type: z.literal("json_schema"),
    name: z.string().min(1),
    schema: z.record(z.string(), z.unknown()),
    strict: z.boolean().optional(),
  }),
]);

export const responsesTextSchema = z.looseObject({
  verbosity: z.enum(["low", "medium", "high"]).optional(),
  format: responsesTextFormatSchema.optional(),
});

export const contextManagementEntrySchema = z.looseObject({
  type: z.string(),
  compact_threshold: positiveIntSchema.nullable().optional(),
});

/**
 * `POST /v1/agent/responses` (OpenAI Responses). Needs `input`, or a non-empty
 * `messages` array as a compatibility fallback.
 */
export const responsesRequestSchema = z
  .looseObject({
    model: modelIdSchema,
    input: z.unknown().optional(),
    messages: z.array(z.unknown()).optional(),
    instructions: z.string().optional(),
    previous_response_id: z.string().optional(),
    stream: z.boolean().optional(),
    truncation: z.enum(["auto", "disabled"]).optional(),
    service_tier: z.enum(["auto", "default", "flex", "priority"]).optional(),
    prompt_cache_key: z.string().min(1).optional(),
    prompt_cache_retention: z.enum(["in-memory", "24h"]).optional(),
    store: z.boolean().optional(),
    parallel_tool_calls: z.boolean().optional(),
    temperature: temperatureSchema.optional(),
    top_p: topPSchema.optional(),
    max_output_tokens: positiveIntSchema.optional(),
    max_tokens: positiveIntSchema.optional(),
    tools: z.array(responsesToolSchema).optional(),
    tool_choice: responsesToolChoiceSchema.optional(),
    reasoning: responsesReasoningSchema.optional(),
    reasoning_effort: reasoningEffortSchema.optional(),
    text: responsesTextSchema.optional(),
    context_management: z.array(contextManagementEntrySchema).nullable().optional(),
    include: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (body) => body.input !== undefined || (body.messages !== undefined && body.messages.length > 0),
    { message: "input is required for Responses API", path: ["input"] },
  );
export type ResponsesRequest = z.infer<typeof responsesRequestSchema>;

/**
 * `POST /v1/agent/responses/compact`. Needs `input`, `previous_response_id`, or
 * a non-empty `messages` array.
 */
export const responsesCompactRequestSchema = z
  .looseObject({
    model: modelIdSchema,
    input: z.unknown().optional(),
    messages: z.array(z.unknown()).optional(),
    instructions: z.string().optional(),
    previous_response_id: z.string().optional(),
  })
  .refine(
    (body) =>
      body.input !== undefined ||
      body.previous_response_id !== undefined ||
      (body.messages !== undefined && body.messages.length > 0),
    { message: "input or previous_response_id is required", path: ["input"] },
  );
export type ResponsesCompactRequest = z.infer<typeof responsesCompactRequestSchema>;

/**
 * Anthropic message roles. `system` and `developer` messages are accepted for
 * compatibility and merged into `system`.
 */
export const anthropicMessageRoleSchema = z.enum(["user", "assistant", "system", "developer"]);

export const anthropicMessageSchema = z.looseObject({
  role: anthropicMessageRoleSchema,
  content: z.unknown().refine((content) => content !== undefined, "content is required"),
});

/**
 * `POST /v1/messages` (aliases `/v1/agent/messages`, `/v1/agent/v1/messages`),
 * Anthropic Messages. Needs at least one user or assistant message. The server
 * drops the OpenRouter routing fields `fallbacks`, `models`, `preset` and
 * `route`, and keeps only the `plugins` that neither select nor run a model.
 */
export const anthropicMessagesRequestSchema = z.looseObject({
  model: modelIdSchema,
  messages: z
    .array(anthropicMessageSchema)
    .min(1)
    .refine(
      (messages) =>
        messages.some((message) => message.role === "user" || message.role === "assistant"),
      "messages must include at least one user or assistant message",
    ),
  system: z.unknown().optional(),
  tools: z.array(z.unknown()).optional(),
});
export type AnthropicMessagesRequest = z.infer<typeof anthropicMessagesRequestSchema>;
