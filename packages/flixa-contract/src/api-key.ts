import { z } from "zod";

/**
 * Deni AI API keys: `deni_` followed by 40 lowercase hex characters (20 random
 * bytes). Issued by apps/web (`src/lib/api-key-utils.ts`) from Settings or the
 * device-auth flow; the agent API rejects keys without the prefix.
 */
export const API_KEY_PREFIX = "deni_";

export const API_KEY_PATTERN = /^deni_[0-9a-f]{40}$/;

/** Length of the stored, displayable key prefix (`deni_` + 8 hex). */
export const API_KEY_DISPLAY_PREFIX_LENGTH = 13;

export const apiKeySchema = z.string().regex(API_KEY_PATTERN);

export type ApiKey = z.infer<typeof apiKeySchema>;

export function isApiKey(value: unknown): value is ApiKey {
  return typeof value === "string" && API_KEY_PATTERN.test(value);
}

/** The `keyPrefix` shown for a key in lists (first 13 characters). */
export function getApiKeyDisplayPrefix(apiKey: string): string {
  return apiKey.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH);
}

/**
 * Request headers the agent API reads an API key from, in order:
 * `Authorization: Bearer deni_...` (or a bare `deni_...` value), then the first
 * non-empty of `x-api-key`, `api-key`, `x-openai-api-key`.
 */
export const API_KEY_HEADERS = [
  "authorization",
  "x-api-key",
  "api-key",
  "x-openai-api-key",
] as const;

/** One API key as listed by the device-auth key-limit response. */
export const apiKeySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** First 13 characters of the key (`deni_` + 8 hex). */
  keyPrefix: z.string(),
  lastUsedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type ApiKeySummary = z.infer<typeof apiKeySummarySchema>;
