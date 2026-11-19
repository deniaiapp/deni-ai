/**
 * In-memory fixed-window rate limits for the Discord bot. The bot runs on exactly one
 * worker instance, so a process-local counter is enough (the standalone Deni Run kept
 * these in a `rate_limits` table, which the platform does not have).
 */
export class RateLimitError extends Error {
  code = "rate_limit" as const;
  constructor() {
    super("Too many requests. Wait a moment and try again.");
    this.name = "RateLimitError";
  }
}

type Window = { start: number; count: number };

const windows = new Map<string, Window>();
const MAX_KEYS = 50_000;

function prune(now: number) {
  for (const [key, value] of windows) {
    // Windows are at most a day long; anything older can go.
    if (now - value.start >= 24 * 60 * 60_000) windows.delete(key);
  }
}

/** Count one request in `bucket` for `subject`; throws {@link RateLimitError} past `limit`. */
export async function assertRateLimit(
  subject: string,
  bucket: string,
  limit: number,
  windowMs = 60_000,
  now = Date.now(),
) {
  const key = `${subject}:${bucket}`;
  if (windows.size > MAX_KEYS) prune(now);
  const current = windows.get(key);
  if (!current || now - current.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > limit) throw new RateLimitError();
}

/** Forget every counter. For tests. */
export function resetRateLimitsForTests() {
  windows.clear();
}
