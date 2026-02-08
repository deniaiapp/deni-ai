import { Context, Next } from 'hono';

interface RequestBody {
  messages?: unknown[];
  model?: string;
}

const VALID_ROLES = ['system', 'user', 'assistant', 'tool'];

/**
 * Validate agent request format
 * Stores validated body in context for reuse
 */
export async function validateAgentRequest(c: Context, next: Next) {
  try {
    const body = await c.req.json<RequestBody>();
    const { messages } = body;

    // Validate messages array
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return c.json({
        error: {
          message: 'messages is required and must be a non-empty array',
          type: 'invalid_request_error',
          param: 'messages',
          code: 'missing_messages'
        }
      }, 400);
    }

    // Validate each message structure
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i] as Record<string, unknown>;
      if (!message.role) {
        return c.json({
          error: {
            message: `Message at index ${i} must have 'role' field`,
            type: 'invalid_request_error',
            param: `messages[${i}]`,
            code: 'invalid_message_format'
          }
        }, 400);
      }

      if (!VALID_ROLES.includes(message.role as string)) {
        return c.json({
          error: {
            message: `Message role must be one of: ${VALID_ROLES.join(', ')}`,
            type: 'invalid_request_error',
            param: `messages[${i}].role`,
            code: 'invalid_role'
          }
        }, 400);
      }

      // Tool messages require tool_call_id, assistant messages with tool_calls may have null content
      if (message.role === 'tool' && !message.tool_call_id) {
        return c.json({
          error: {
            message: `Tool message at index ${i} must have 'tool_call_id' field`,
            type: 'invalid_request_error',
            param: `messages[${i}]`,
            code: 'invalid_message_format'
          }
        }, 400);
      }
    }

    // Store validated body in context for reuse
    c.set('validatedBody', body);

    await next();
  } catch (error) {
    return c.json({
      error: {
        message: 'Invalid JSON in request body',
        type: 'invalid_request_error',
        param: 'body',
        code: 'invalid_json'
      }
    }, 400);
  }
}
