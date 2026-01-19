import { Context, Next } from 'hono';

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface RequestBody {
  messages?: Message[];
}

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
      const message = messages[i];
      if (!message.role || !message.content) {
        return c.json({
          error: {
            message: `Message at index ${i} must have 'role' and 'content' fields`,
            type: 'invalid_request_error',
            param: `messages[${i}]`,
            code: 'invalid_message_format'
          }
        }, 400);
      }

      if (!['system', 'user', 'assistant'].includes(message.role)) {
        return c.json({
          error: {
            message: `Message role must be one of: system, user, assistant`,
            type: 'invalid_request_error',
            param: `messages[${i}].role`,
            code: 'invalid_role'
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
