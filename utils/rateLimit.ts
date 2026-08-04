/**
 * Process-local fixed-window rate limiter.
 *
 * Suitable for single-instance / sticky routing. Multi-instance deployments
 * share no state (each process enforces its own window); distributed
 * coordination is intentionally out of scope and should be measured at the
 * deployment layer if needed.
 */

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix epoch seconds when the current window resets. */
  resetAt: number;
  /** Seconds until the client may retry (0 when allowed). */
  retryAfterSec: number;
};

type Bucket = {
  count: number;
  /** Window start (ms). */
  windowStart: number;
};

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
  const raw = Bun.env.RATE_LIMIT_ENABLED?.toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  return true;
}

/** Global /v1 IP limits (pre-auth abuse shield). */
export function getIpRateLimitConfig(): { max: number; windowMs: number } {
  return {
    max: parsePositiveInt(Bun.env.RATE_LIMIT_IP_MAX, 180),
    windowMs: parsePositiveInt(Bun.env.RATE_LIMIT_IP_WINDOW_MS, 60_000),
  };
}

/** Per authenticated user limits (agent / models / deni). */
export function getUserRateLimitConfig(): { max: number; windowMs: number } {
  return {
    max: parsePositiveInt(Bun.env.RATE_LIMIT_USER_MAX, 90),
    windowMs: parsePositiveInt(Bun.env.RATE_LIMIT_USER_WINDOW_MS, 60_000),
  };
}

/** Admin login POST limits (brute-force shield). */
export function getAdminLoginRateLimitConfig(): {
  max: number;
  windowMs: number;
} {
  return {
    max: parsePositiveInt(Bun.env.RATE_LIMIT_ADMIN_LOGIN_MAX, 20),
    windowMs: parsePositiveInt(
      Bun.env.RATE_LIMIT_ADMIN_LOGIN_WINDOW_MS,
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

/**
 * Consume one request for `key` within a fixed window.
 * Window is keyed by the limiter name so IP/user/login limits stay independent.
 */
export function consumeRateLimit(
  scope: string,
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  if (!isRateLimitEnabled() || max < 1 || windowMs < 1) {
    return {
      allowed: true,
      limit: max,
      remaining: max,
      resetAt: Math.ceil((now + windowMs) / 1000),
      retryAfterSec: 0,
    };
  }

  maybeCleanup(now);

  const mapKey = `${scope}:${key}`;
  let bucket = buckets.get(mapKey);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { count: 0, windowStart: now };
    buckets.set(mapKey, bucket);
    scheduleBucketExpiry(mapKey, bucket);
  }

  const resetAtMs = bucket.windowStart + windowMs;
  const resetAt = Math.ceil(resetAtMs / 1000);

  if (bucket.count >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
    return {
      allowed: false,
      limit: max,
      remaining: 0,
      resetAt,
      retryAfterSec,
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    limit: max,
    remaining: Math.max(0, max - bucket.count),
    resetAt,
    retryAfterSec: 0,
  };
}

/** Test helper. */
export function clearRateLimitBuckets(): void {
  resetBuckets();
  opsSinceCleanup = 0;
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

/**
 * Best-effort client IP for rate limiting.
 * Prefers proxy headers when present (first X-Forwarded-For hop).
 */
export function getClientIp(headers: Headers, fallback = "unknown"): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, 128);

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 128);

  const xff = headers.get("x-forwarded-for")?.trim();
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }

  return fallback;
}
