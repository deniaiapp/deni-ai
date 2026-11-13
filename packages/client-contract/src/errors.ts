import { z } from "zod";

/**
 * Error codes of the native client API. Every non-2xx response of
 * `/api/client/v1` carries {@link clientErrorSchema}; the beta gate's 403 uses
 * the same shape. Clients branch on `code`; `message` is English and meant for
 * logs, not for display.
 */
export const CLIENT_ERROR_CODES = [
  /** 400: the body or query failed validation. */
  "invalid_request",
  /** 401: no credential, or the access token is expired, revoked or lacks the `chat` scope. */
  "unauthorized",
  /** 403: the account has not been invited to the private beta. */
  "beta_access_required",
  /** 403: the account may not do this (for example a model its plan does not include). */
  "forbidden",
  /** 404: the chat or route does not exist, or belongs to someone else. */
  "not_found",
  /** 405 */
  "method_not_allowed",
  /** 426: the client is older than `bootstrap.client.minVersion`. */
  "client_update_required",
  /** 429: see the `Retry-After` header. */
  "rate_limited",
  /** 500 */
  "internal_error",
] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

export const clientErrorSchema = z.object({
  /** Same value as `code`; kept for parity with the web app's existing JSON errors. */
  error: z.string(),
  code: z.string(),
  message: z.string(),
});
export type ClientError = z.infer<typeof clientErrorSchema>;
