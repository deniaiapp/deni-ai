import { z } from "zod";
import { apiKeySchema, apiKeySummarySchema } from "./api-key.js";

/**
 * Device authorization for the Flixa extension and CLI:
 * `POST /api/device-auth` on the Deni AI web app (apps/web
 * `src/server/http/device-auth/route.ts`). Every request body is JSON with an
 * `action`:
 *
 * 1. `initiate` (unauthenticated): returns a `userCode` to show the user and a
 *    secret `deviceCode` to poll with. Rate limited to 5 per minute per IP.
 * 2. `approve` (browser session, same-origin JSON only): the signed-in user
 *    approves the `userCode`, optionally revoking one key when at the limit.
 * 3. `poll` (unauthenticated): the client polls with its `deviceCode` until
 *    approved; the first approved poll issues the API key. 60 per minute per
 *    IP and 3 per 10 seconds per device code.
 *
 * Errors are `{ error: string }` (see {@link deviceAuthErrorSchema}); 429
 * responses carry `Retry-After`.
 */
export const DEVICE_AUTH_PATH = "/api/device-auth";

/** Seconds a device code stays valid. */
export const DEVICE_AUTH_EXPIRES_IN_SECONDS = 900;

/** Maximum API keys per account; approval and issuance enforce it. */
export const MAX_API_KEYS = 5;

/** `ABCD-EFGH` from an alphabet without I, O, 0 and 1. */
export const USER_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** 32 random bytes as lowercase hex. */
export const DEVICE_CODE_PATTERN = /^[0-9a-f]{64}$/;

export const deviceAuthActionSchema = z.enum(["initiate", "approve", "poll"]);
export type DeviceAuthAction = z.infer<typeof deviceAuthActionSchema>;

export const deviceAuthInitiateRequestSchema = z.object({ action: z.literal("initiate") });
export type DeviceAuthInitiateRequest = z.infer<typeof deviceAuthInitiateRequestSchema>;

export const deviceAuthInitiateResponseSchema = z.object({
  userCode: z.string().regex(USER_CODE_PATTERN),
  deviceCode: z.string().regex(DEVICE_CODE_PATTERN),
  expiresIn: z.number().int().positive(),
});
export type DeviceAuthInitiateResponse = z.infer<typeof deviceAuthInitiateResponseSchema>;

export const deviceAuthApproveRequestSchema = z.object({
  action: z.literal("approve"),
  userCode: z.string().regex(USER_CODE_PATTERN),
  /** Key to revoke in the same transaction when the account is at {@link MAX_API_KEYS}. */
  revokeKeyId: z.string().min(1).optional(),
});
export type DeviceAuthApproveRequest = z.infer<typeof deviceAuthApproveRequestSchema>;

export const deviceAuthApproveResponseSchema = z.object({ success: z.literal(true) });
export type DeviceAuthApproveResponse = z.infer<typeof deviceAuthApproveResponseSchema>;

export const deviceAuthPollRequestSchema = z.object({
  action: z.literal("poll"),
  deviceCode: z.string().regex(DEVICE_CODE_PATTERN),
});
export type DeviceAuthPollRequest = z.infer<typeof deviceAuthPollRequestSchema>;

export const deviceAuthRequestSchema = z.discriminatedUnion("action", [
  deviceAuthInitiateRequestSchema,
  deviceAuthApproveRequestSchema,
  deviceAuthPollRequestSchema,
]);
export type DeviceAuthRequest = z.infer<typeof deviceAuthRequestSchema>;

/** Not approved yet: keep polling. */
export const deviceAuthPollPendingSchema = z.object({ approved: z.literal(false) });

/** Approved and issued (or redelivered once within a few minutes of issue). */
export const deviceAuthPollIssuedSchema = z.object({
  approved: z.literal(true),
  apiKey: apiKeySchema,
  apiKeyId: z.string(),
});

/**
 * Approved, but the key was already delivered, revoked, or is past the
 * redelivery window: start a new flow.
 */
export const deviceAuthPollUnavailableSchema = z.object({
  approved: z.literal(true),
  apiKeyUnavailable: z.literal(true),
});

export const deviceAuthPollResponseSchema = z.union([
  deviceAuthPollPendingSchema,
  deviceAuthPollIssuedSchema,
  deviceAuthPollUnavailableSchema,
]);
export type DeviceAuthPollResponse = z.infer<typeof deviceAuthPollResponseSchema>;

/**
 * Error body of every device-auth failure.
 *
 * - 400 `Invalid request` / `Invalid action`, 413 body over 4 KiB, 415 approve
 *   without `application/json`, 403 `Forbidden origin` (approve from another
 *   origin), 401 `Unauthorized` (approve without a session), 404 `Invalid code` /
 *   `Invalid device code` / `API key not found.`, 409 `Already approved`,
 *   410 `Code expired`, 429 `Too many requests. Please slow down.`
 * - 403 with `reason: "anonymous_forbidden"`: guest accounts cannot approve.
 * - `code: "API_KEY_LIMIT_REACHED"` with the account's `apiKeys`: 409 on approve
 *   (retry with `revokeKeyId`), 403 on poll.
 */
export const deviceAuthErrorSchema = z.object({
  error: z.string(),
  code: z.literal("API_KEY_LIMIT_REACHED").optional(),
  apiKeys: z.array(apiKeySummarySchema).optional(),
  reason: z.literal("anonymous_forbidden").optional(),
});
export type DeviceAuthError = z.infer<typeof deviceAuthErrorSchema>;

export const apiKeyLimitReachedErrorSchema = z.object({
  code: z.literal("API_KEY_LIMIT_REACHED"),
  error: z.string(),
  apiKeys: z.array(apiKeySummarySchema),
});
export type ApiKeyLimitReachedError = z.infer<typeof apiKeyLimitReachedErrorSchema>;
