/**
 * Client-facing error payloads that never expose internal or upstream
 * details (exception messages, provider bodies, env var names). Only the
 * status code and short machine-readable `type` / `code` identifiers are
 * forwarded so clients can still branch on e.g. `context_length_exceeded`.
 */

export interface PublicErrorBody {
  error: {
    message: string;
    type: string;
    param: null;
    code: string | null;
  };
}

const IDENTIFIER_PATTERN = /^[a-z0-9_.-]{1,64}$/i;

export function publicErrorMessage(status: number): string {
  if (status === 400 || status === 422) return "Invalid request";
  if (status === 401) return "Authentication failed";
  if (status === 403) return "Permission denied";
  if (status === 404) return "Not found";
  if (status === 408 || status === 504) return "Request timed out";
  if (status === 413) return "Request too large";
  if (status === 429) return "Too many requests";
  if (status === 503 || status === 529) return "Service temporarily unavailable";
  if (status >= 500) return "Internal server error";
  return "Request failed";
}

function defaultErrorType(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 429) return "rate_limit_error";
  if (status >= 500) return "server_error";
  return "invalid_request_error";
}

function safeIdentifier(value: unknown): string | null {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value)
    ? value
    : null;
}

export function publicErrorBody(
  status: number,
  options: { type?: unknown; code?: unknown } = {},
): PublicErrorBody {
  return {
    error: {
      message: publicErrorMessage(status),
      type: safeIdentifier(options.type) ?? defaultErrorType(status),
      param: null,
      code: safeIdentifier(options.code),
    },
  };
}

/** Extracts only `type` / `code` from an upstream error body (OpenAI or Anthropic shape). */
function parseUpstreamErrorIdentifiers(rawBody: string): {
  type?: unknown;
  code?: unknown;
} {
  try {
    const parsed = JSON.parse(rawBody) as {
      error?: { type?: unknown; code?: unknown } | unknown;
    };
    const error = parsed?.error;
    if (error && typeof error === "object") {
      const { type, code } = error as { type?: unknown; code?: unknown };
      return { type, code };
    }
  } catch {
    // Non-JSON upstream body: fall back to status-derived defaults.
  }
  return {};
}

/** Replaces an upstream non-2xx body with a sanitized JSON error. */
export function publicUpstreamErrorResponse(
  status: number,
  rawBody: string,
): Response {
  return Response.json(
    publicErrorBody(status, parseUpstreamErrorIdentifiers(rawBody)),
    { status },
  );
}
