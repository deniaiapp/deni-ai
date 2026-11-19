import { z } from "zod";
import { planTierSchema } from "./usage.js";

/**
 * Every error from the agent API (services/agent-api) uses the OpenAI error
 * envelope, including the Anthropic-compatible `/messages` routes:
 *
 * ```json
 * { "error": { "message": "...", "type": "...", "param": null, "code": "..." } }
 * ```
 *
 * `type` and `code` are machine-readable. Upstream provider errors are
 * forwarded as their sanitized `type` / `code` identifiers (for example
 * `context_length_exceeded`), so both fields can hold values outside the lists
 * below; `code` can be null. Some errors add fields next to these four (see
 * {@link quotaExceededErrorSchema} and {@link insufficientPlanErrorSchema}).
 */
export const FLIXA_ERROR_TYPES = [
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "insufficient_plan",
  "quota_exceeded",
  "rate_limit_error",
  "server_error",
  "api_error",
] as const;
export type FlixaErrorType = (typeof FLIXA_ERROR_TYPES)[number];

/** Error codes the agent API itself emits, grouped by cause. */
export const FLIXA_ERROR_CODES = {
  /** 401 unless noted. */
  authentication: [
    "missing_api_key",
    "missing_auth_header",
    "invalid_key",
    "expired_key",
    /** 403 */
    "guest_account",
    /** 403; a blocked account (the response never says "banned"). */
    "service_unavailable",
    /** 403; outdated Flixa or AI SDK client on Free/Go. */
    "client_update_required",
    /** 503 (`server_error`); also returned when ban or plan status is unknown. */
    "db_error",
  ],
  /** 403, `insufficient_plan`. */
  plan: ["missing_client_signal", "tier_restricted"],
  /** 429. */
  limits: ["USAGE_LIMIT_EXCEEDED", "rate_limit_exceeded"],
  /** 400 (`model_not_found`: 404), `invalid_request_error`. */
  request: [
    "missing_model",
    "model_not_found",
    "unsupported_model",
    "missing_messages",
    "missing_input",
    "invalid_message_format",
    "invalid_role",
    "invalid_tool",
    "invalid_parameter",
    "invalid_json",
  ],
  /** 500, `server_error`. */
  server: ["missing_provider_key", "unsupported_provider", "usage_fetch_error"],
} as const;

export type FlixaErrorCode = (typeof FLIXA_ERROR_CODES)[keyof typeof FLIXA_ERROR_CODES][number];

export const ALL_FLIXA_ERROR_CODES: readonly FlixaErrorCode[] =
  Object.values(FLIXA_ERROR_CODES).flat();

export const flixaErrorBodySchema = z.looseObject({
  message: z.string(),
  type: z.string(),
  param: z.string().nullable(),
  code: z.string().nullable(),
});

export const flixaErrorEnvelopeSchema = z.object({ error: flixaErrorBodySchema });
export type FlixaErrorEnvelope = z.infer<typeof flixaErrorEnvelopeSchema>;

export function isFlixaErrorEnvelope(value: unknown): value is FlixaErrorEnvelope {
  return flixaErrorEnvelopeSchema.safeParse(value).success;
}

/**
 * 429 when the monthly pool cannot cover the request's reservation. Distinct
 * from `rate_limit_exceeded` (short-window request rate, with `Retry-After`).
 */
export const quotaExceededErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.literal("quota_exceeded"),
    param: z.null(),
    code: z.literal("USAGE_LIMIT_EXCEEDED"),
    category: z.enum(["basic", "premium"]),
    tier: planTierSchema,
    /** Free accounts without a verified card get a larger pool after verifying. */
    canVerifyForBoost: z.boolean(),
    canUpgrade: z.boolean(),
    verifyUrl: z.string(),
    upgradeUrl: z.string(),
  }),
});
export type QuotaExceededError = z.infer<typeof quotaExceededErrorSchema>;

/** 403 when the plan does not allow the client or the model. */
export const insufficientPlanErrorSchema = z.object({
  error: z.union([
    z.object({
      message: z.string(),
      type: z.literal("insufficient_plan"),
      param: z.null(),
      code: z.literal("missing_client_signal"),
      tier: planTierSchema,
      upgradeUrl: z.string(),
    }),
    z.object({
      message: z.string(),
      type: z.literal("insufficient_plan"),
      param: z.literal("model"),
      code: z.literal("tier_restricted"),
    }),
  ]),
});
export type InsufficientPlanError = z.infer<typeof insufficientPlanErrorSchema>;

export const rateLimitErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.literal("rate_limit_error"),
    param: z.null(),
    code: z.literal("rate_limit_exceeded"),
  }),
});
export type RateLimitError = z.infer<typeof rateLimitErrorSchema>;
