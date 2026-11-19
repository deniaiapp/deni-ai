// In-memory fixed-window rate limiting. The server runs as a single Node process,
// so this is enough to slow down abuse; counters reset on restart.

type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, window] of buckets) {
    if (window.resetAt <= now) buckets.delete(key);
  }
}

/** @returns seconds until the caller may retry, or 0 when the request is allowed */
export function rateLimit(key: string, limit: number, windowMs: number): number {
  const now = Date.now();
  sweep(now);

  const window = buckets.get(key);
  if (!window || window.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 0;
  }
  if (window.count >= limit) return Math.ceil((window.resetAt - now) / 1000);

  window.count += 1;
  return 0;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (
    request.headers.get('cf-connecting-ip') ??
    forwarded ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}
