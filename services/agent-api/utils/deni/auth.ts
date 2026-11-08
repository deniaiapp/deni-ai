import { API_KEY_PREFIX, hashApiKeySync } from '@deniai/auth/api-key/node';
import { getDeniPool } from './db';

export type ApiKeyValidationResult =
  | { valid: true; userId: string }
  | { valid: false; error: string; code: 'invalid_key' | 'expired_key' | 'guest_account' | 'db_error' };

export const GUEST_ACCOUNT_ERROR_MESSAGE =
  'Guest accounts are not supported. Please sign in with a permanent account.';

function getNonNegativeIntEnv(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const AUTH_CACHE_TTL_MS = getNonNegativeIntEnv('FLIXA_AUTH_CACHE_TTL_MS', 60_000);
const AUTH_NEGATIVE_CACHE_TTL_MS = getNonNegativeIntEnv(
  'FLIXA_AUTH_NEGATIVE_CACHE_TTL_MS',
  30_000,
);
const AUTH_CACHE_MAX_ENTRIES = 10_000;
const LAST_USED_UPDATE_INTERVAL_MS = 5 * 60_000;
// Keys are short opaque tokens; anything longer is never hashed or queried.
const MAX_API_KEY_LENGTH = 256;

// Short-TTL cache of successful key validations. Saves one SELECT (+ JOIN)
// per request on hot keys, so revocations take effect within AUTH_CACHE_TTL_MS.
const keyValidationCache = new Map<string, { userId: string; expiresAt: number }>();
// Short-TTL cache of "not found" / "expired" answers, so replaying a bad key
// does not hit the DB each time. Bounded like keyValidationCache. DB errors
// and guest accounts (which may upgrade) are not cached.
type CachedInvalidResult = Extract<ApiKeyValidationResult, { valid: false }>;
const invalidKeyCache = new Map<string, { result: CachedInvalidResult; expiresAt: number }>();
const keyValidationInFlight = new Map<string, Promise<ApiKeyValidationResult>>();
const lastUsedWriteAt = new Map<string, number>();

// Uncached key lookups may hold at most this many pool connections (pool max
// defaults to 10), so a flood of distinct bad keys cannot starve usage, ban
// and other queries. Extra lookups wait in a bounded queue, then get db_error.
const MAX_CONCURRENT_KEY_LOOKUPS = Math.max(
  1,
  getNonNegativeIntEnv('FLIXA_AUTH_MAX_CONCURRENT_LOOKUPS', 8),
);
const MAX_QUEUED_KEY_LOOKUPS = getNonNegativeIntEnv('FLIXA_AUTH_MAX_QUEUED_LOOKUPS', 64);
let activeKeyLookups = 0;
const queuedKeyLookups: Array<() => void> = [];

/** Wait for a lookup slot; false when the queue is full. */
async function acquireKeyLookupSlot(): Promise<boolean> {
  if (activeKeyLookups < MAX_CONCURRENT_KEY_LOOKUPS) {
    activeKeyLookups += 1;
    return true;
  }

  if (queuedKeyLookups.length >= MAX_QUEUED_KEY_LOOKUPS) {
    return false;
  }

  // releaseKeyLookupSlot hands its slot straight to the next waiter.
  await new Promise<void>((resolve) => queuedKeyLookups.push(resolve));
  return true;
}

function releaseKeyLookupSlot(): void {
  const next = queuedKeyLookups.shift();
  if (next) {
    next();
    return;
  }
  activeKeyLookups -= 1;
}

function cacheInvalidKey(keyHash: string, result: CachedInvalidResult): void {
  if (AUTH_NEGATIVE_CACHE_TTL_MS <= 0) return;

  if (invalidKeyCache.size >= AUTH_CACHE_MAX_ENTRIES) {
    invalidKeyCache.clear();
  }

  invalidKeyCache.set(keyHash, {
    result,
    expiresAt: Date.now() + AUTH_NEGATIVE_CACHE_TTL_MS,
  });
}

function getCachedInvalidKey(keyHash: string): CachedInvalidResult | null {
  const entry = invalidKeyCache.get(keyHash);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    invalidKeyCache.delete(keyHash);
    return null;
  }

  return entry.result;
}

function cacheValidKey(keyHash: string, userId: string): void {
  if (AUTH_CACHE_TTL_MS <= 0) return;

  if (keyValidationCache.size >= AUTH_CACHE_MAX_ENTRIES) {
    keyValidationCache.clear();
  }

  keyValidationCache.set(keyHash, {
    userId,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
  });
}

function getCachedValidKey(keyHash: string): string | null {
  const entry = keyValidationCache.get(keyHash);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    keyValidationCache.delete(keyHash);
    return null;
  }

  return entry.userId;
}

/**
 * Drop cached successful key validations for a user (or the entire cache).
 * Called when keys are revoked (e.g. Flixa ban) so ban takes effect immediately.
 */
export function invalidateUserAuthCache(userId?: string): void {
  if (!userId) {
    keyValidationCache.clear();
    invalidKeyCache.clear();
    lastUsedWriteAt.clear();
    return;
  }

  for (const [keyHash, entry] of keyValidationCache) {
    if (entry.userId === userId) {
      keyValidationCache.delete(keyHash);
      lastUsedWriteAt.delete(keyHash);
    }
  }
}

/**
 * Update last_used_at at most once per LAST_USED_UPDATE_INTERVAL_MS per key
 * instead of on every request (fire and forget).
 */
function touchLastUsedAt(keyHash: string): void {
  const now = Date.now();
  const lastWrite = lastUsedWriteAt.get(keyHash);
  if (lastWrite !== undefined && now - lastWrite < LAST_USED_UPDATE_INTERVAL_MS) {
    return;
  }

  if (lastUsedWriteAt.size >= AUTH_CACHE_MAX_ENTRIES) {
    lastUsedWriteAt.clear();
  }
  lastUsedWriteAt.set(keyHash, now);

  getDeniPool()
    .query(`UPDATE api_key SET last_used_at = NOW() WHERE key_hash = $1`, [keyHash])
    .catch(err => console.error('Failed to update last_used_at:', err));
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Extract API key from Authorization Bearer or x-api-key.
 * HTTP Basic credentials are not treated as an API key.
 * Bearer matching is case-insensitive. A raw `deni_…` Authorization value
 * (no scheme) is also accepted.
 */
export function extractApiKey(
  authHeader: string | undefined,
  apiKeyHeader: string | undefined,
): string | null {
  if (apiKeyHeader && apiKeyHeader.trim().length > 0) {
    return apiKeyHeader.trim();
  }

  if (!authHeader) return null;

  const trimmed = authHeader.trim();
  if (!trimmed) return null;

  if (/^basic\s+/i.test(trimmed)) return null;

  if (/^bearer\s+/i.test(trimmed)) {
    const key = trimmed.replace(/^bearer\s+/i, '').trim();
    return key.length > 0 ? key : null;
  }

  if (trimmed.startsWith('deni_')) {
    return trimmed;
  }

  return null;
}

/**
 * Dedicated key headers Codex / OpenAI-compatible clients sometimes use
 * instead of (or in addition to) Authorization.
 */
export function extractApiKeyFromHeaders(headers: Headers): string | null {
  return extractApiKey(
    headers.get('authorization') ?? undefined,
    firstNonEmpty(
      headers.get('x-api-key'),
      headers.get('api-key'),
      headers.get('x-openai-api-key'),
    ) ?? undefined,
  );
}

export type RequestAuthSummary = {
  hasAuthorization: boolean;
  authorizationScheme: string | null;
  hasXApiKey: boolean;
  hasApiKey: boolean;
  hasOpenaiApiKey: boolean;
};

/**
 * Presence-only auth header summary for logs. Never includes secret values.
 */
export function summarizeRequestAuth(headers: Headers): RequestAuthSummary {
  const authorization = (headers.get('authorization') || '').trim();
  let authorizationScheme: string | null = null;
  if (authorization) {
    const scheme = authorization.split(/\s+/, 1)[0] || authorization;
    authorizationScheme = scheme.toLowerCase().startsWith('deni_')
      ? 'deni_'
      : scheme;
  }

  return {
    hasAuthorization: authorization.length > 0,
    authorizationScheme,
    hasXApiKey: Boolean(headers.get('x-api-key')?.trim()),
    hasApiKey: Boolean(headers.get('api-key')?.trim()),
    hasOpenaiApiKey: Boolean(headers.get('x-openai-api-key')?.trim()),
  };
}

/**
 * Fingerprint for logs and admin lookup. Never log the full secret.
 * Example: `deni_abc1…wxyz`
 */
export function redactApiKey(rawKey: string | null | undefined): string | null {
  if (!rawKey) return null;
  const key = rawKey.trim();
  if (!key) return null;
  if (key.length <= 12) {
    return `${key.slice(0, Math.min(4, key.length))}…`;
  }
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export function redactApiKeyFromHeaders(
  authHeader: string | undefined,
  apiKeyHeader: string | undefined,
): string | null {
  return redactApiKey(extractApiKey(authHeader, apiKeyHeader));
}

export function redactApiKeyFromRequestHeaders(headers: Headers): string | null {
  return redactApiKey(extractApiKeyFromHeaders(headers));
}

/**
 * SHA-256 hex digest stored in `api_key.key_hash`; the same hashing the web app
 * uses when it issues keys (`@deniai/auth/api-key`).
 */
export function hashApiKey(rawKey: string): string {
  return hashApiKeySync(rawKey);
}

/**
 * Validate a Deni API key and return the associated user ID
 */
export async function validateDeniApiKey(rawKey: string): Promise<ApiKeyValidationResult> {
  if (!rawKey.startsWith(API_KEY_PREFIX) || rawKey.length > MAX_API_KEY_LENGTH) {
    return { valid: false, error: 'Invalid API key format', code: 'invalid_key' };
  }

  const keyHash = hashApiKey(rawKey);

  const cachedUserId = getCachedValidKey(keyHash);
  if (cachedUserId !== null) {
    touchLastUsedAt(keyHash);
    return { valid: true, userId: cachedUserId };
  }

  const cachedInvalid = getCachedInvalidKey(keyHash);
  if (cachedInvalid !== null) {
    return cachedInvalid;
  }

  const existing = keyValidationInFlight.get(keyHash);
  if (existing) return existing;

  const validation = (async (): Promise<ApiKeyValidationResult> => {
    if (!(await acquireKeyLookupSlot())) {
      console.error('API key validation error: too many concurrent lookups');
      return { valid: false, error: 'Database error during validation', code: 'db_error' };
    }

    try {
      const pool = getDeniPool();
      const result = await pool.query<{
        user_id: string;
        expires_at: Date | null;
        is_anonymous: boolean;
      }>(
        `SELECT k.user_id, k.expires_at, COALESCE(u.is_anonymous, false) AS is_anonymous
         FROM api_key k
         JOIN "user" u ON u.id = k.user_id
         WHERE k.key_hash = $1`,
        [keyHash]
      );

      if (result.rows.length === 0) {
        const notFound: CachedInvalidResult = {
          valid: false,
          error: 'API key not found',
          code: 'invalid_key',
        };
        cacheInvalidKey(keyHash, notFound);
        return notFound;
      }

      const { user_id, expires_at, is_anonymous } = result.rows[0];

      if (is_anonymous) {
        return { valid: false, error: GUEST_ACCOUNT_ERROR_MESSAGE, code: 'guest_account' };
      }

      // Check expiration
      if (expires_at && new Date(expires_at) < new Date()) {
        const expired: CachedInvalidResult = {
          valid: false,
          error: 'API key has expired',
          code: 'expired_key',
        };
        cacheInvalidKey(keyHash, expired);
        return expired;
      }

      // Cache only until shortly before expiration so an expiring key is not
      // served from cache past its expiry.
      if (
        !expires_at ||
        new Date(expires_at).getTime() - Date.now() > AUTH_CACHE_TTL_MS
      ) {
        cacheValidKey(keyHash, user_id);
      }

      touchLastUsedAt(keyHash);

      return { valid: true, userId: user_id };
    } catch (error) {
      console.error('API key validation error:', error);
      return { valid: false, error: 'Database error during validation', code: 'db_error' };
    } finally {
      releaseKeyLookupSlot();
    }
  })();

  keyValidationInFlight.set(keyHash, validation);
  void validation.then(
    () => {
      if (keyValidationInFlight.get(keyHash) === validation) {
        keyValidationInFlight.delete(keyHash);
      }
    },
    () => {
      if (keyValidationInFlight.get(keyHash) === validation) {
        keyValidationInFlight.delete(keyHash);
      }
    },
  );

  return validation;
}
