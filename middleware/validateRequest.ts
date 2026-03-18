import { Context, Next } from 'hono';

interface RequestBody {
  messages?: unknown[];
  model?: string;
  temperature?: unknown;
  top_p?: unknown;
  frequency_penalty?: unknown;
  presence_penalty?: unknown;
  max_tokens?: unknown;
  tools?: unknown;
}

const VALID_ROLES = ['system', 'user', 'assistant', 'tool'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Validate agent request format
 * Stores validated body in context for reuse
 */
export async function validateAgentRequest(c: Context, next: Next) {
  try {
    const body = await c.req.json<RequestBody>();
    const { messages, model, temperature, top_p, frequency_penalty, presence_penalty, max_tokens, tools } = body;

    if (!model || typeof model !== 'string') {
      return c.json({
        error: {
          message: 'model is required and must be a string',
          type: 'invalid_request_error',
          param: 'model',
          code: 'missing_model'
        }
      }, 400);
    }

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

      if (message.content === undefined && message.role !== 'assistant') {
        return c.json({
          error: {
            message: `Message at index ${i} must have 'content' field`,
            type: 'invalid_request_error',
            param: `messages[${i}].content`,
            code: 'invalid_message_format'
          }
        }, 400);
      }
    }

    const numericChecks: Array<[string, unknown, (value: number) => boolean, string]> = [
      ['temperature', temperature, (value) => value >= 0 && value <= 2, 'temperature must be a number between 0 and 2'],
      ['top_p', top_p, (value) => value >= 0 && value <= 1, 'top_p must be a number between 0 and 1'],
      ['frequency_penalty', frequency_penalty, (value) => value >= -2 && value <= 2, 'frequency_penalty must be a number between -2 and 2'],
      ['presence_penalty', presence_penalty, (value) => value >= -2 && value <= 2, 'presence_penalty must be a number between -2 and 2'],
      ['max_tokens', max_tokens, (value) => Number.isInteger(value) && value > 0, 'max_tokens must be a positive integer'],
    ];

    for (const [param, value, predicate, message] of numericChecks) {
      if (value === undefined) continue;

      if (!isFiniteNumber(value) || !predicate(value)) {
        return c.json({
          error: {
            message,
            type: 'invalid_request_error',
            param,
            code: 'invalid_parameter'
          }
        }, 400);
      }
    }

    if (tools !== undefined) {
      if (!Array.isArray(tools)) {
        return c.json({
          error: {
            message: 'tools must be an array',
            type: 'invalid_request_error',
            param: 'tools',
            code: 'invalid_parameter'
          }
        }, 400);
      }

      for (let i = 0; i < tools.length; i++) {
        const tool = tools[i];
        if (!isObject(tool) || tool.type !== 'function' || !isObject(tool.function) || typeof tool.function.name !== 'string') {
          return c.json({
            error: {
              message: `Tool at index ${i} must be a function tool with a string name`,
              type: 'invalid_request_error',
              param: `tools[${i}]`,
              code: 'invalid_tool'
            }
          }, 400);
        }
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
