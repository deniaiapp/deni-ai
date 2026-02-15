import { Context, Next } from 'hono';

interface AnthropicRequestBody {
  model?: string;
  messages?: unknown[];
}

const VALID_ROLES = ['user', 'assistant'];

/**
 * Validate Anthropic-compatible messages request format.
 * Stores validated body in context for reuse.
 */
export async function validateAnthropicRequest(c: Context, next: Next) {
  try {
    const body = await c.req.json<AnthropicRequestBody>();
    const { messages, model } = body;

    if (!model || typeof model !== 'string') {
      return c.json({
        error: {
          message: 'model is required and must be a string',
          type: 'invalid_request_error',
          param: 'model',
          code: 'missing_model',
        },
      }, 400);
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return c.json({
        error: {
          message: 'messages is required and must be a non-empty array',
          type: 'invalid_request_error',
          param: 'messages',
          code: 'missing_messages',
        },
      }, 400);
    }

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i] as Record<string, unknown>;
      const role = message.role as string | undefined;

      if (!role || !VALID_ROLES.includes(role)) {
        return c.json({
          error: {
            message: `Message role must be one of: ${VALID_ROLES.join(', ')}`,
            type: 'invalid_request_error',
            param: `messages[${i}].role`,
            code: 'invalid_role',
          },
        }, 400);
      }

      if (message.content === undefined) {
        return c.json({
          error: {
            message: `Message at index ${i} must have 'content' field`,
            type: 'invalid_request_error',
            param: `messages[${i}].content`,
            code: 'invalid_message_format',
          },
        }, 400);
      }
    }

    c.set('validatedBody', body);

    await next();
  } catch (error) {
    return c.json({
      error: {
        message: 'Invalid JSON in request body',
        type: 'invalid_request_error',
        param: 'body',
        code: 'invalid_json',
      },
    }, 400);
  }
}
