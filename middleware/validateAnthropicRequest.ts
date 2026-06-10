import { Context, Next } from "hono";

interface AnthropicRequestBody {
  model?: string;
  messages?: unknown[];
  system?: unknown;
}

const VALID_MESSAGE_ROLES = ["user", "assistant"] as const;
const SYSTEM_COMPAT_ROLES = ["system", "developer"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;

  if (!Array.isArray(content)) return "";

  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        isObject(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

function mergeSystemPrompt(existingSystem: unknown, systemMessages: unknown[]) {
  if (systemMessages.length === 0) {
    return existingSystem;
  }

  const parts = [
    extractTextContent(existingSystem),
    ...systemMessages.map((message) =>
      isObject(message) ? extractTextContent(message.content) : "",
    ),
  ].filter((text) => text.length > 0);

  if (parts.length === 0) {
    return existingSystem;
  }

  return parts.join("\n");
}

/**
 * Validate Anthropic-compatible messages request format.
 * Stores validated body in context for reuse.
 */
export async function validateAnthropicRequest(c: Context, next: Next) {
  try {
    const body = await c.req.json<AnthropicRequestBody>();
    const { messages, model } = body;

    if (!model || typeof model !== "string") {
      return c.json(
        {
          error: {
            message: "model is required and must be a string",
            type: "invalid_request_error",
            param: "model",
            code: "missing_model",
          },
        },
        400,
      );
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return c.json(
        {
          error: {
            message: "messages is required and must be a non-empty array",
            type: "invalid_request_error",
            param: "messages",
            code: "missing_messages",
          },
        },
        400,
      );
    }

    const normalizedMessages: unknown[] = [];
    const systemMessages: unknown[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      if (!isObject(message)) {
        return c.json(
          {
            error: {
              message: `Message at index ${i} must be an object`,
              type: "invalid_request_error",
              param: `messages[${i}]`,
              code: "invalid_message_format",
            },
          },
          400,
        );
      }

      const role = message.role as string | undefined;

      if (role && SYSTEM_COMPAT_ROLES.includes(role as (typeof SYSTEM_COMPAT_ROLES)[number])) {
        systemMessages.push(message);
        continue;
      }

      if (!role || !VALID_MESSAGE_ROLES.includes(role as (typeof VALID_MESSAGE_ROLES)[number])) {
        return c.json(
          {
            error: {
              message: `Message role must be one of: ${[
                ...VALID_MESSAGE_ROLES,
                ...SYSTEM_COMPAT_ROLES,
              ].join(", ")}`,
              type: "invalid_request_error",
              param: `messages[${i}].role`,
              code: "invalid_role",
            },
          },
          400,
        );
      }

      if (message.content === undefined) {
        return c.json(
          {
            error: {
              message: `Message at index ${i} must have 'content' field`,
              type: "invalid_request_error",
              param: `messages[${i}].content`,
              code: "invalid_message_format",
            },
          },
          400,
        );
      }

      normalizedMessages.push(message);
    }

    if (normalizedMessages.length === 0) {
      return c.json(
        {
          error: {
            message: "messages must include at least one user or assistant message",
            type: "invalid_request_error",
            param: "messages",
            code: "missing_messages",
          },
        },
        400,
      );
    }

    c.set("validatedBody", {
      ...body,
      messages: normalizedMessages,
      system: mergeSystemPrompt(body.system, systemMessages),
    });

    await next();
  } catch {
    return c.json(
      {
        error: {
          message: "Invalid JSON in request body",
          type: "invalid_request_error",
          param: "body",
          code: "invalid_json",
        },
      },
      400,
    );
  }
}
