/**
 * Fixed-window rate limiter.
 *
 * - Node / single process: process-local in-memory buckets (`consumeRateLimit`).
 * - Cloudflare Workers: when `configureDurableRateLimit(namespace)` has been
 *   called, `consumeRateLimitAsync` routes each `${scope}:${key}` to its own
 *   Durable Object (`RateLimiterDO`) so limits hold across isolates.
 *   DO failures fail open (request allowed) and are logged with `[RateLimit]`.
 */

import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import { isAuthDisabledMode } from "./authMode";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix epoch seconds when the current window resets. */
  resetAt: number;
  /** Seconds until the client may retry (0 when allowed). */
  retryAfterSec: number;
};

export type RateLimitBucket = {
  count: number;
  /** Window start (ms). */
  windowStart: number;
  /** Window length (ms) the bucket was opened with. */
  windowMs: number;
};

type Bucket = RateLimitBucket;

let buckets = new Map<string, Bucket>();

/** Max keys retained; oldest-ish entries are cleared when exceeded. */
const MAX_BUCKETS = 50_000;
const CLEANUP_EVERY = 2_000;
const BUCKET_IDLE_TTL_MS = 15 * 60_000;
let opsSinceCleanup = 0;

/**
 * Indexed min-heap with at most one expiry entry per live bucket. A key that
 * rolls into a new window updates its existing heap node, so the index itself
 * cannot grow from stale entries. Cleanup is proportional to expired buckets
 * instead of scanning every live bucket.
 */
type BucketExpiry = {
  mapKey: string;
  windowStart: number;
  expiresAt: number;
};

const bucketExpiryHeap: BucketExpiry[] = [];
const bucketExpiryIndices = new Map<string, number>();

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export function isRateLimitEnabled(): boolean {
  if (isAuthDisabledMode()) {
    return false;
  }

  const raw = process.env.RATE_LIMIT_ENABLED?.toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  return true;
}

/** Global /v1 IP limits (pre-auth abuse shield). */
export function getIpRateLimitConfig(): { max: number; windowMs: number } {
  return {
    max: parsePositiveInt(process.env.RATE_LIMIT_IP_MAX, 180),
    windowMs: parsePositiveInt(process.env.RATE_LIMIT_IP_WINDOW_MS, 60_000),
  };
}

/** Per authenticated user limits (agent / models / deni). */
export function getUserRateLimitConfig(): { max: number; windowMs: number } {
  return {
    max: parsePositiveInt(process.env.RATE_LIMIT_USER_MAX, 90),
    windowMs: parsePositiveInt(process.env.RATE_LIMIT_USER_WINDOW_MS, 60_000),
  };
}

/** Admin login POST limits (brute-force shield). */
export function getAdminLoginRateLimitConfig(): {
  max: number;
  windowMs: number;
} {
  return {
    max: parsePositiveInt(process.env.RATE_LIMIT_ADMIN_LOGIN_MAX, 20),
    windowMs: parsePositiveInt(
      process.env.RATE_LIMIT_ADMIN_LOGIN_WINDOW_MS,
      15 * 60_000,
    ),
  };
}

function swapBucketExpiry(leftIndex: number, rightIndex: number): void {
  const left = bucketExpiryHeap[leftIndex]!;
  const right = bucketExpiryHeap[rightIndex]!;
  bucketExpiryHeap[leftIndex] = right;
  bucketExpiryHeap[rightIndex] = left;
  bucketExpiryIndices.set(right.mapKey, leftIndex);
  bucketExpiryIndices.set(left.mapKey, rightIndex);
}

function bubbleBucketExpiryUp(index: number): void {
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (
      bucketExpiryHeap[parentIndex]!.expiresAt <=
      bucketExpiryHeap[index]!.expiresAt
    ) {
      break;
    }
    swapBucketExpiry(parentIndex, index);
    index = parentIndex;
  }
}

function bubbleBucketExpiryDown(index: number): void {
  while (true) {
    const leftIndex = index * 2 + 1;
    if (leftIndex >= bucketExpiryHeap.length) {
      break;
    }

    const rightIndex = leftIndex + 1;
    let childIndex = leftIndex;
    if (
      rightIndex < bucketExpiryHeap.length &&
      bucketExpiryHeap[rightIndex]!.expiresAt <
        bucketExpiryHeap[leftIndex]!.expiresAt
    ) {
      childIndex = rightIndex;
    }

    if (
      bucketExpiryHeap[index]!.expiresAt <=
      bucketExpiryHeap[childIndex]!.expiresAt
    ) {
      break;
    }

    swapBucketExpiry(index, childIndex);
    index = childIndex;
  }
}

function scheduleBucketExpiry(mapKey: string, bucket: Bucket): void {
  const expiry: BucketExpiry = {
    mapKey,
    windowStart: bucket.windowStart,
    expiresAt: bucket.windowStart + BUCKET_IDLE_TTL_MS,
  };
  const existingIndex = bucketExpiryIndices.get(mapKey);

  if (existingIndex === undefined) {
    const index = bucketExpiryHeap.length;
    bucketExpiryHeap.push(expiry);
    bucketExpiryIndices.set(mapKey, index);
    bubbleBucketExpiryUp(index);
    return;
  }

  const previous = bucketExpiryHeap[existingIndex]!;
  bucketExpiryHeap[existingIndex] = expiry;
  bucketExpiryIndices.set(mapKey, existingIndex);
  if (expiry.expiresAt < previous.expiresAt) {
    bubbleBucketExpiryUp(existingIndex);
  } else if (expiry.expiresAt > previous.expiresAt) {
    bubbleBucketExpiryDown(existingIndex);
  }
}

function dequeueBucketExpiry(): BucketExpiry | undefined {
  const first = bucketExpiryHeap[0];
  if (!first) {
    return undefined;
  }

  const last = bucketExpiryHeap.pop()!;
  bucketExpiryIndices.delete(first.mapKey);
  if (bucketExpiryHeap.length > 0) {
    bucketExpiryHeap[0] = last;
    bucketExpiryIndices.set(last.mapKey, 0);
    bubbleBucketExpiryDown(0);
  }

  return first;
}

function cleanupExpiredBuckets(now: number): void {
  // The old implementation used the same strict `>` idle check. Do not
  // expire a bucket exactly at the TTL boundary.
  while (
    bucketExpiryHeap.length > 0 &&
    bucketExpiryHeap[0]!.expiresAt < now
  ) {
    const expiry = dequeueBucketExpiry()!;
    const bucket = buckets.get(expiry.mapKey);

    // The indexed heap normally guarantees this match. Reschedule defensively
    // if a future bucket representation changes independently.
    if (!bucket) {
      continue;
    }
    if (bucket.windowStart === expiry.windowStart) {
      buckets.delete(expiry.mapKey);
    } else {
      scheduleBucketExpiry(expiry.mapKey, bucket);
    }
  }
}

function resetBuckets(): void {
  // Replacing the Map avoids making the hard-cap path walk the old Map.
  buckets = new Map<string, Bucket>();
  bucketExpiryHeap.length = 0;
  bucketExpiryIndices.clear();
}

function maybeCleanup(now: number): void {
  opsSinceCleanup += 1;
  if (opsSinceCleanup < CLEANUP_EVERY && buckets.size < MAX_BUCKETS) {
    return;
  }
  opsSinceCleanup = 0;

  // Drop idle buckets (no hits in 15m). Window sizes are shorter than this.
  // The heap visits only due expiry entries, never the full live Map.
  cleanupExpiredBuckets(now);

  if (buckets.size >= MAX_BUCKETS) {
    // Hard cap: clear everything rather than O(n log n) eviction.
    resetBuckets();
  }
}

function allowAllResult(
  max: number,
  windowMs: number,
  now: number,
): RateLimitResult {
  return {
    allowed: true,
    limit: max,
    remaining: max,
    resetAt: Math.ceil((now + windowMs) / 1000),
    retryAfterSec: 0,
  };
}

function shouldBypass(max: number, windowMs: number): boolean {
  return !isRateLimitEnabled() || max < 1 || windowMs < 1;
}

/**
 * Pure fixed-window step shared by the in-memory limiter and `RateLimiterDO`.
 * Opens a new bucket when none exists or the window elapsed; otherwise mutates
 * `bucket.count` in place. Callers must handle `max < 1 || windowMs < 1`.
 */
export function applyFixedWindow(
  bucket: RateLimitBucket | undefined,
  max: number,
  windowMs: number,
  now: number,
): { bucket: RateLimitBucket; result: RateLimitResult; isNewWindow: boolean } {
  let isNewWindow = false;
  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { count: 0, windowStart: now, windowMs };
    isNewWindow = true;
  }

  const resetAtMs = bucket.windowStart + windowMs;
  const resetAt = Math.ceil(resetAtMs / 1000);

  if (bucket.count >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
    return {
      bucket,
      isNewWindow,
      result: {
        allowed: false,
        limit: max,
        remaining: 0,
        resetAt,
        retryAfterSec,
      },
    };
  }

  bucket.count += 1;
  return {
    bucket,
    isNewWindow,
    result: {
      allowed: true,
      limit: max,
      remaining: Math.max(0, max - bucket.count),
      resetAt,
      retryAfterSec: 0,
    },
  };
}

/**
 * Consume one request for `key` within a fixed window (process-local only).
 * Window is keyed by the limiter name so IP/user/login limits stay independent.
 * Request paths should use `consumeRateLimitAsync`, which honours the Durable
 * Object backend when configured.
 */
export function consumeRateLimit(
  scope: string,
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  if (shouldBypass(max, windowMs)) {
    return allowAllResult(max, windowMs, now);
  }

  maybeCleanup(now);

  const mapKey = `${scope}:${key}`;
  const step = applyFixedWindow(buckets.get(mapKey), max, windowMs, now);
  if (step.isNewWindow) {
    buckets.set(mapKey, step.bucket);
    scheduleBucketExpiry(mapKey, step.bucket);
  }
  return step.result;
}

// ---------------------------------------------------------------------------
// Durable Object backend (Cloudflare Workers)
// ---------------------------------------------------------------------------

let durableNamespace: DurableObjectNamespace | null = null;

const DO_ERROR_LOG_INTERVAL_MS = 60_000;
let lastDoErrorLogAt = 0;
let suppressedDoErrors = 0;

/**
 * Route rate limiting through a Durable Object namespace (Workers). Pass
 * `null` to return to the in-memory limiter.
 */
export function configureDurableRateLimit(
  namespace: DurableObjectNamespace | null,
): void {
  durableNamespace = namespace;
}

function logDurableError(error: unknown): void {
  const now = Date.now();
  if (now - lastDoErrorLogAt < DO_ERROR_LOG_INTERVAL_MS) {
    suppressedDoErrors += 1;
    return;
  }
  const suppressed = suppressedDoErrors;
  lastDoErrorLogAt = now;
  suppressedDoErrors = 0;
  console.error(
    `[RateLimit] durable object call failed; failing open${
      suppressed > 0 ? ` (${suppressed} similar errors suppressed)` : ""
    }:`,
    error instanceof Error ? error.message : error,
  );
}

function isRateLimitResult(value: unknown): value is RateLimitResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.allowed === "boolean" &&
    typeof v.limit === "number" &&
    typeof v.remaining === "number" &&
    typeof v.resetAt === "number" &&
    typeof v.retryAfterSec === "number"
  );
}

async function consumeDurable(
  namespace: DurableObjectNamespace,
  scope: string,
  key: string,
  max: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const stub = namespace.get(namespace.idFromName(`${scope}:${key}`));
  const response = await stub.fetch("https://rate-limiter.internal/consume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ max, windowMs }),
  });
  if (!response.ok) {
    throw new Error(`RateLimiterDO responded ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isRateLimitResult(body)) {
    throw new Error("RateLimiterDO returned an invalid payload");
  }
  return body;
}

/**
 * Consume one request for `key`. Uses the Durable Object backend when
 * configured, otherwise the in-memory limiter. Never throws: DO failures are
 * logged and the request is allowed (fail open).
 */
export async function consumeRateLimitAsync(
  scope: string,
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): Promise<RateLimitResult> {
  const namespace = durableNamespace;
  if (!namespace) {
    return consumeRateLimit(scope, key, max, windowMs, now);
  }
  if (shouldBypass(max, windowMs)) {
    return allowAllResult(max, windowMs, now);
  }
  try {
    return await consumeDurable(namespace, scope, key, max, windowMs);
  } catch (error) {
    logDurableError(error);
    return allowAllResult(max, windowMs, now);
  }
}

/** Test helper. */
export function clearRateLimitBuckets(): void {
  resetBuckets();
  opsSinceCleanup = 0;
  lastDoErrorLogAt = 0;
  suppressedDoErrors = 0;
}

/**
 * Agent inference endpoints are metered by monthly usage quota already and
 * must not be short-window rate limited (chat completions, responses, messages).
 */
export function isAgentInferencePath(path: string): boolean {
  // Strip trailing slash except root.
  const p =
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;

  return (
    p === "/v1/agent/chat/completions" ||
    p === "/v1/agent/responses" ||
    p === "/v1/agent/responses/compact" ||
    p === "/v1/messages" ||
    p === "/v1/agent/messages" ||
    p === "/v1/agent/v1/messages"
  );
}

export { getClientIp } from "./clientIp";
