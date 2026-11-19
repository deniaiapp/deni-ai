import { convertResponsesInputContentToChat } from "./converters";
import { getModelDefinition } from "./models";

/** Request fields Deni AI API's /v1/responses reads; it drops the rest. */
const DENI_RESPONSES_FIELDS = [
  "model",
  "instructions",
  "input",
  "stream",
  "max_output_tokens",
  "temperature",
  "top_p",
  "tools",
  "tool_choice",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deni AI API's /v1/responses rebuilds each request as a Chat Completions
 * call: it reads only DENI_RESPONSES_FIELDS and forwards message content and
 * tool_choice unchanged. Reshape a normalized Responses request to match, so
 * reasoning / include / store are not sent.
 */
export function toDeniResponsesRequest(
  request: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const field of DENI_RESPONSES_FIELDS) {
    if (request[field] !== undefined) {
      next[field] = request[field];
    }
  }

  next.input = convertResponsesInputContentToChat(next.input);

  // Deni AI API caps output at 1024 tokens when this is missing.
  next.max_output_tokens ??= getModelDefinition(
    String(request.model),
  )?.maxOutputTokens;

  if (next.tools === undefined) {
    delete next.tool_choice;
  } else if (
    isRecord(next.tool_choice) &&
    next.tool_choice.type === "function" &&
    typeof next.tool_choice.name === "string"
  ) {
    next.tool_choice = {
      type: "function",
      function: { name: next.tool_choice.name },
    };
  }

  return next;
}
