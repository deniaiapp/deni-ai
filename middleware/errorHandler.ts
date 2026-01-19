import { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

interface ErrorWithStatus extends Error {
  statusCode?: number;
  status?: number;
  type?: string;
  param?: string | null;
  code?: string | null;
}

/**
 * Global error handler middleware
 */
export function errorHandler(err: ErrorWithStatus, c: Context) {
  console.error('Error:', err);

  // OpenAI-style error response
  const statusCode = (err.statusCode || err.status || 500) as ContentfulStatusCode;
  
  return c.json({
    error: {
      message: err.message || 'Internal server error',
      type: err.type || 'server_error',
      param: err.param || null,
      code: err.code || null
    }
  }, statusCode);
}
