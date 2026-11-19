import { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { publicErrorBody } from "../utils/agent/publicError";

interface ErrorWithStatus extends Error {
  statusCode?: number;
  status?: number;
  type?: string;
  param?: string | null;
  code?: string | null;
}

/**
 * Global error handler middleware.
 *
 * Hono middleware such as `basicAuth` throws `HTTPException` with a prepared
 * Response (status, body, WWW-Authenticate, etc.). Those must be returned as-is
 * so browser Basic Auth challenges and correct status bodies are preserved.
 */
export function errorHandler(err: ErrorWithStatus, c: Context) {
  // Prefer HTTPException.getResponse() — matches Hono's default onError.
  if (err instanceof HTTPException) {
    const res = err.getResponse();
    // Expected auth failures shouldn't spam as "Error:"; other HTTPExceptions might.
    if (err.status >= 500) {
      console.error("Error:", err);
    }
    return c.newResponse(res.body, res);
  }

  // Some libraries attach getResponse without being instanceof HTTPException.
  const maybeGetResponse = (err as unknown as { getResponse?: () => Response })
    .getResponse;
  if (typeof maybeGetResponse === "function") {
    const res = maybeGetResponse.call(err);
    return c.newResponse(res.body, res);
  }

  console.error("Error:", err);

  // OpenAI-style error response for unexpected failures
  const statusCode = (err.statusCode ||
    err.status ||
    500) as ContentfulStatusCode;

  // Never echo exception messages to clients; details stay in server logs.
  return c.json(
    publicErrorBody(statusCode, { type: err.type, code: err.code }),
    statusCode,
  );
}
