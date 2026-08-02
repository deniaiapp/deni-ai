import { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { resolveAvailableModelId } from "../utils/agent/models";

interface ChatRequestBody {
  messages?: unknown[];
  model?: string;
  temperature?: unknown;
  top_p?: unknown;
  frequency_penalty?: unknown;
  presence_penalty?: unknown;
  max_tokens?: unknown;
  tools?: unknown;
}

interface ResponsesRequestBody {
  input?: unknown;
  instructions?: unknown;
  model?: string;
  temperature?: unknown;
  top_p?: unknown;
  max_output_tokens?: unknown;
  max_tokens?: unknown;
  stream?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
  reasoning?: unknown;
  reasoning_effort?: unknown;
  text?: unknown;
  previous_response_id?: unknown;
  store?: unknown;
  include?: unknown;
  parallel_tool_calls?: unknown;
  metadata?: unknown;
  messages?: unknown[];
  context_management?: unknown;
}

interface ResponsesCompactRequestBody {
  input?: unknown;
  instructions?: unknown;
  model?: string;
  previous_response_id?: unknown;
  messages?: unknown[];
}

const VALID_CHAT_ROLES = ["system", "developer", "user", "assistant", "tool"] as const;
const VALID_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
const VALID_TEXT_FORMAT_TYPES = ["text", "json_object", "json_schema"] as const;
const VALID_TEXT_VERBOSITY = ["low", "medium", "high"] as const;
const VALID_REASONING_SUMMARY = ["auto", "concise", "detailed"] as const;
const VALID_REASONING_CONTEXT = ["auto", "current_turn", "all_turns"] as const;
const VALID_REASONING_MODE = ["standard", "pro"] as const;
const VALID_TOOL_CHOICE = ["none", "auto", "required"] as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function invalidRequest(
  c: Context,
  message: string,
  param: string | null,
  code: string,
  status: ContentfulStatusCode = 400,
) {
  return c.json(
    {
      error: {
        message,
        type: "invalid_request_error",
        param,
        code,
      },
    },
    { status },
  );
}

function validateNumericParams(
  c: Context,
  checks: Array<[string, unknown, (value: number) => boolean, string]>,
) {
  for (const [param, value, predicate, message] of checks) {
    if (value === undefined) continue;

    if (!isFiniteNumber(value) || !predicate(value)) {
      return invalidRequest(c, message, param, "invalid_parameter");
    }
  }

  return null;
}

function validateChatMessages(c: Context, messages: unknown) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return invalidRequest(
      c,
      "messages is required and must be a non-empty array",
      "messages",
      "missing_messages",
    );
  }

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    if (!isObject(message)) {
      return invalidRequest(
        c,
        `Message at index ${i} must be an object`,
        `messages[${i}]`,
        "invalid_message_format",
      );
    }

    if (typeof message.role !== "string") {
      return invalidRequest(
        c,
        `Message at index ${i} must have 'role' field`,
        `messages[${i}]`,
        "invalid_message_format",
      );
    }

    if (
      !VALID_CHAT_ROLES.includes(
        message.role as (typeof VALID_CHAT_ROLES)[number],
      )
    ) {
      return invalidRequest(
        c,
        `Message role must be one of: ${VALID_CHAT_ROLES.join(", ")}`,
        `messages[${i}].role`,
        "invalid_role",
      );
    }

    if (message.role === "tool" && typeof message.tool_call_id !== "string") {
      return invalidRequest(
        c,
        `Tool message at index ${i} must have 'tool_call_id' field`,
        `messages[${i}]`,
        "invalid_message_format",
      );
    }

    if (message.content === undefined && message.role !== "assistant") {
      return invalidRequest(
        c,
        `Message at index ${i} must have 'content' field`,
        `messages[${i}].content`,
        "invalid_message_format",
      );
    }
  }

  return null;
}

function validateTools(
  c: Context,
  tools: unknown,
  options?: {
    allowChatStyleFunctionWrapper?: boolean;
    allowNonFunctionTypes?: boolean;
  },
) {
  if (tools === undefined) {
    return null;
  }

  if (!Array.isArray(tools)) {
    return invalidRequest(
      c,
      "tools must be an array",
      "tools",
      "invalid_parameter",
    );
  }

  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i];

    if (!isObject(tool) || typeof tool.type !== "string") {
      return invalidRequest(
        c,
        `Tool at index ${i} must have a string 'type' field`,
        `tools[${i}]`,
        "invalid_tool",
      );
    }

    const allowChatStyleFunctionWrapper =
      options?.allowChatStyleFunctionWrapper ?? false;
    const allowNonFunctionTypes = options?.allowNonFunctionTypes ?? false;

    if (tool.type !== "function") {
      if (allowNonFunctionTypes) {
        continue;
      }

      return invalidRequest(
        c,
        `Tool at index ${i} must have type 'function'`,
        `tools[${i}]`,
        "invalid_tool",
      );
    }

    if (allowChatStyleFunctionWrapper) {
      const directName = typeof tool.name === "string" ? tool.name : null;
      const wrappedFunction = isObject(tool.function) ? tool.function : null;
      const wrappedName =
        wrappedFunction && typeof wrappedFunction.name === "string"
          ? wrappedFunction.name
          : null;

      if (!directName && !wrappedName) {
        return invalidRequest(
          c,
          `Tool at index ${i} must have a string name`,
          `tools[${i}]`,
          "invalid_tool",
        );
      }

      continue;
    }

    if (!isObject(tool.function) || typeof tool.function.name !== "string") {
      return invalidRequest(
        c,
        `Tool at index ${i} must be a function tool with a string name`,
        `tools[${i}]`,
        "invalid_tool",
      );
    }
  }

  return null;
}

function validateReasoningEffort(c: Context, value: unknown, param: string) {
  if (value === undefined) {
    return null;
  }

  if (
    typeof value !== "string" ||
    !VALID_REASONING_EFFORTS.includes(
      value as (typeof VALID_REASONING_EFFORTS)[number],
    )
  ) {
    return invalidRequest(
      c,
      `reasoning effort must be one of: ${VALID_REASONING_EFFORTS.join(", ")}`,
      param,
      "invalid_parameter",
    );
  }

  return null;
}

function validateResponsesToolChoice(c: Context, toolChoice: unknown) {
  if (toolChoice === undefined) {
    return null;
  }

  if (
    typeof toolChoice === "string" &&
    VALID_TOOL_CHOICE.includes(toolChoice as (typeof VALID_TOOL_CHOICE)[number])
  ) {
    return null;
  }

  if (!isObject(toolChoice)) {
    return invalidRequest(
      c,
      'tool_choice must be one of "none", "auto", "required", or a function selector',
      "tool_choice",
      "invalid_parameter",
    );
  }

  if (toolChoice.type !== "function") {
    if (typeof toolChoice.type === "string") {
      return null;
    }

    return invalidRequest(
      c,
      'tool_choice must be one of "none", "auto", "required", or a valid tool selector',
      "tool_choice",
      "invalid_parameter",
    );
  }

  if (typeof toolChoice.name === "string") {
    return null;
  }

  if (
    isObject(toolChoice.function) &&
    typeof toolChoice.function.name === "string"
  ) {
    return null;
  }

  return invalidRequest(
    c,
    'tool_choice must be one of "none", "auto", "required", or a function selector',
    "tool_choice",
    "invalid_parameter",
  );
}

function validateResponsesReasoning(c: Context, reasoning: unknown) {
  if (reasoning === undefined) {
    return null;
  }

  if (!isObject(reasoning)) {
    return invalidRequest(
      c,
      "reasoning must be an object",
      "reasoning",
      "invalid_parameter",
    );
  }

  const effortError = validateReasoningEffort(
    c,
    reasoning.effort,
    "reasoning.effort",
  );
  if (effortError) {
    return effortError;
  }

  if (
    reasoning.summary !== undefined &&
    (typeof reasoning.summary !== "string" ||
      !VALID_REASONING_SUMMARY.includes(
        reasoning.summary as (typeof VALID_REASONING_SUMMARY)[number],
      ))
  ) {
    return invalidRequest(
      c,
      `reasoning.summary must be one of: ${VALID_REASONING_SUMMARY.join(", ")}`,
      "reasoning.summary",
      "invalid_parameter",
    );
  }

  if (
    reasoning.context !== undefined &&
    (typeof reasoning.context !== "string" ||
      !VALID_REASONING_CONTEXT.includes(
        reasoning.context as (typeof VALID_REASONING_CONTEXT)[number],
      ))
  ) {
    return invalidRequest(
      c,
      `reasoning.context must be one of: ${VALID_REASONING_CONTEXT.join(", ")}`,
      "reasoning.context",
      "invalid_parameter",
    );
  }

  if (
    reasoning.mode !== undefined &&
    (typeof reasoning.mode !== "string" ||
      !VALID_REASONING_MODE.includes(
        reasoning.mode as (typeof VALID_REASONING_MODE)[number],
      ))
  ) {
    return invalidRequest(
      c,
      `reasoning.mode must be one of: ${VALID_REASONING_MODE.join(", ")}`,
      "reasoning.mode",
      "invalid_parameter",
    );
  }

  return null;
}

function validateContextManagement(c: Context, contextManagement: unknown) {
  if (contextManagement === undefined || contextManagement === null) {
    return null;
  }

  if (!Array.isArray(contextManagement)) {
    return invalidRequest(
      c,
      "context_management must be an array or null",
      "context_management",
      "invalid_parameter",
    );
  }

  for (const [index, entry] of contextManagement.entries()) {
    if (!isObject(entry) || typeof entry.type !== "string") {
      return invalidRequest(
        c,
        `context_management[${index}] must be an object with a string type`,
        "context_management",
        "invalid_parameter",
      );
    }

    if (
      entry.compact_threshold !== undefined &&
      entry.compact_threshold !== null &&
      (!isFiniteNumber(entry.compact_threshold) ||
        !Number.isInteger(entry.compact_threshold) ||
        entry.compact_threshold <= 0)
    ) {
      return invalidRequest(
        c,
        `context_management[${index}].compact_threshold must be a positive integer or null`,
        "context_management",
        "invalid_parameter",
      );
    }
  }

  return null;
}

function validateResponsesTextConfig(c: Context, text: unknown) {
  if (text === undefined) {
    return null;
  }

  if (!isObject(text)) {
    return invalidRequest(
      c,
      "text must be an object",
      "text",
      "invalid_parameter",
    );
  }

  if (
    text.verbosity !== undefined &&
    (typeof text.verbosity !== "string" ||
      !VALID_TEXT_VERBOSITY.includes(
        text.verbosity as (typeof VALID_TEXT_VERBOSITY)[number],
      ))
  ) {
    return invalidRequest(
      c,
      `text.verbosity must be one of: ${VALID_TEXT_VERBOSITY.join(", ")}`,
      "text.verbosity",
      "invalid_parameter",
    );
  }

  if (text.format === undefined) {
    return null;
  }

  if (!isObject(text.format)) {
    return invalidRequest(
      c,
      "text.format must be an object",
      "text.format",
      "invalid_parameter",
    );
  }

  if (
    typeof text.format.type !== "string" ||
    !VALID_TEXT_FORMAT_TYPES.includes(
      text.format.type as (typeof VALID_TEXT_FORMAT_TYPES)[number],
    )
  ) {
    return invalidRequest(
      c,
      `text.format.type must be one of: ${VALID_TEXT_FORMAT_TYPES.join(", ")}`,
      "text.format.type",
      "invalid_parameter",
    );
  }

  if (text.format.type === "json_schema") {
    if (typeof text.format.name !== "string" || text.format.name.length === 0) {
      return invalidRequest(
        c,
        "text.format.name is required when text.format.type is json_schema",
        "text.format.name",
        "invalid_parameter",
      );
    }

    if (!isObject(text.format.schema)) {
      return invalidRequest(
        c,
        "text.format.schema is required when text.format.type is json_schema",
        "text.format.schema",
        "invalid_parameter",
      );
    }

    if (text.format.strict !== undefined && !isBoolean(text.format.strict)) {
      return invalidRequest(
        c,
        "text.format.strict must be a boolean",
        "text.format.strict",
        "invalid_parameter",
      );
    }
  }

  return null;
}

/**
 * Validate agent request format
 * Stores validated body in context for reuse
 */
export async function validateAgentRequest(c: Context, next: Next) {
  try {
    const body = await c.req.json<ChatRequestBody>();
    const {
      messages,
      model,
      temperature,
      top_p,
      frequency_penalty,
      presence_penalty,
      max_tokens,
      tools,
    } = body;

    if (!model || typeof model !== "string") {
      return invalidRequest(
        c,
        "model is required and must be a string",
        "model",
        "missing_model",
      );
    }

    const messagesError = validateChatMessages(c, messages);
    if (messagesError) {
      return messagesError;
    }

    const numericError = validateNumericParams(c, [
      [
        "temperature",
        temperature,
        (value) => value >= 0 && value <= 2,
        "temperature must be a number between 0 and 2",
      ],
      [
        "top_p",
        top_p,
        (value) => value >= 0 && value <= 1,
        "top_p must be a number between 0 and 1",
      ],
      [
        "frequency_penalty",
        frequency_penalty,
        (value) => value >= -2 && value <= 2,
        "frequency_penalty must be a number between -2 and 2",
      ],
      [
        "presence_penalty",
        presence_penalty,
        (value) => value >= -2 && value <= 2,
        "presence_penalty must be a number between -2 and 2",
      ],
      [
        "max_tokens",
        max_tokens,
        (value) => Number.isInteger(value) && value > 0,
        "max_tokens must be a positive integer",
      ],
    ]);

    if (numericError) {
      return numericError;
    }

    const toolsError = validateTools(c, tools);
    if (toolsError) {
      return toolsError;
    }

    c.set("validatedBody", {
      ...body,
      model: resolveAvailableModelId(model),
    });
    await next();
  } catch {
    return invalidRequest(
      c,
      "Invalid JSON in request body",
      "body",
      "invalid_json",
    );
  }
}

/**
 * Validate Responses API request format
 * Supports OpenAI Responses-style `input` and limited `messages` fallback compatibility.
 * Stores validated body in context for reuse.
 */
export async function validateResponsesRequest(c: Context, next: Next) {
  try {
    const body = await c.req.json<ResponsesRequestBody>();
    const {
      input,
      instructions,
      model,
      temperature,
      top_p,
      max_output_tokens,
      max_tokens,
      stream,
      tools,
      tool_choice,
      reasoning,
      reasoning_effort,
      text,
      previous_response_id,
      store,
      include,
      parallel_tool_calls,
      metadata,
      messages,
      context_management,
    } = body;

    if (!model || typeof model !== "string") {
      return invalidRequest(
        c,
        "model is required and must be a string",
        "model",
        "missing_model",
      );
    }

    if (
      input === undefined &&
      (!Array.isArray(messages) || messages.length === 0)
    ) {
      return invalidRequest(
        c,
        "input is required for Responses API",
        "input",
        "missing_input",
      );
    }

    if (instructions !== undefined && typeof instructions !== "string") {
      return invalidRequest(
        c,
        "instructions must be a string",
        "instructions",
        "invalid_parameter",
      );
    }

    if (
      previous_response_id !== undefined &&
      typeof previous_response_id !== "string"
    ) {
      return invalidRequest(
        c,
        "previous_response_id must be a string",
        "previous_response_id",
        "invalid_parameter",
      );
    }

    if (stream !== undefined && !isBoolean(stream)) {
      return invalidRequest(
        c,
        "stream must be a boolean",
        "stream",
        "invalid_parameter",
      );
    }

    if (store !== undefined && !isBoolean(store)) {
      return invalidRequest(
        c,
        "store must be a boolean",
        "store",
        "invalid_parameter",
      );
    }

    if (parallel_tool_calls !== undefined && !isBoolean(parallel_tool_calls)) {
      return invalidRequest(
        c,
        "parallel_tool_calls must be a boolean",
        "parallel_tool_calls",
        "invalid_parameter",
      );
    }

    const numericError = validateNumericParams(c, [
      [
        "temperature",
        temperature,
        (value) => value >= 0 && value <= 2,
        "temperature must be a number between 0 and 2",
      ],
      [
        "top_p",
        top_p,
        (value) => value >= 0 && value <= 1,
        "top_p must be a number between 0 and 1",
      ],
      [
        "max_output_tokens",
        max_output_tokens,
        (value) => Number.isInteger(value) && value > 0,
        "max_output_tokens must be a positive integer",
      ],
      [
        "max_tokens",
        max_tokens,
        (value) => Number.isInteger(value) && value > 0,
        "max_tokens must be a positive integer",
      ],
    ]);

    if (numericError) {
      return numericError;
    }

    const toolsError = validateTools(c, tools, {
      allowChatStyleFunctionWrapper: true,
      allowNonFunctionTypes: true,
    });
    if (toolsError) {
      return toolsError;
    }

    const toolChoiceError = validateResponsesToolChoice(c, tool_choice);
    if (toolChoiceError) {
      return toolChoiceError;
    }

    const reasoningError = validateResponsesReasoning(c, reasoning);
    if (reasoningError) {
      return reasoningError;
    }

    const reasoningEffortError = validateReasoningEffort(
      c,
      reasoning_effort,
      "reasoning_effort",
    );
    if (reasoningEffortError) {
      return reasoningEffortError;
    }

    const textError = validateResponsesTextConfig(c, text);
    if (textError) {
      return textError;
    }

    const contextManagementError = validateContextManagement(
      c,
      context_management,
    );
    if (contextManagementError) {
      return contextManagementError;
    }

    if (include !== undefined && !isStringArray(include)) {
      return invalidRequest(
        c,
        "include must be an array of strings",
        "include",
        "invalid_parameter",
      );
    }

    if (metadata !== undefined && !isObject(metadata)) {
      return invalidRequest(
        c,
        "metadata must be an object",
        "metadata",
        "invalid_parameter",
      );
    }

    c.set("validatedBody", {
      ...body,
      model: resolveAvailableModelId(model),
    });
    await next();
  } catch {
    return invalidRequest(
      c,
      "Invalid JSON in request body",
      "body",
      "invalid_json",
    );
  }
}

/**
 * Validate standalone Responses compact endpoint body.
 * POST /v1/agent/responses/compact
 */
export async function validateResponsesCompactRequest(c: Context, next: Next) {
  try {
    const body = await c.req.json<ResponsesCompactRequestBody>();
    const {
      input,
      instructions,
      model,
      previous_response_id,
      messages,
    } = body;

    if (!model || typeof model !== "string") {
      return invalidRequest(
        c,
        "model is required and must be a string",
        "model",
        "missing_model",
      );
    }

    if (
      input === undefined &&
      previous_response_id === undefined &&
      (!Array.isArray(messages) || messages.length === 0)
    ) {
      return invalidRequest(
        c,
        "input or previous_response_id is required for Responses compact",
        "input",
        "missing_input",
      );
    }

    if (instructions !== undefined && typeof instructions !== "string") {
      return invalidRequest(
        c,
        "instructions must be a string",
        "instructions",
        "invalid_parameter",
      );
    }

    if (
      previous_response_id !== undefined &&
      typeof previous_response_id !== "string"
    ) {
      return invalidRequest(
        c,
        "previous_response_id must be a string",
        "previous_response_id",
        "invalid_parameter",
      );
    }

    c.set("validatedBody", {
      ...body,
      model: resolveAvailableModelId(model),
    });
    await next();
  } catch {
    return invalidRequest(
      c,
      "Invalid JSON in request body",
      "body",
      "invalid_json",
    );
  }
}
