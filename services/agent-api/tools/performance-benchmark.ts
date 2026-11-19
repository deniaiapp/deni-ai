/**
 * Deterministic, local-only performance benchmark for the in-process rate
 * limiter. It does not create HTTP requests and never touches an upstream or
 * database. The limiter remains process-local by design; this measures only
 * the bucket/expiry bookkeeping in one Node process.
 *
 * Examples:
 *   pnpm run performance:benchmark
 *   pnpm run performance:benchmark -- --iterations=120000 --keys=40000
 */

import { clearRateLimitBuckets, consumeRateLimit } from "../utils/rateLimit";

const DEFAULT_ITERATIONS = 120_000;
const DEFAULT_KEYS = 40_000;
const IDLE_TTL_MS = 15 * 60_000;
const BASE_NOW = 1_700_000_000_000;

function readPositiveInteger(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  if (!argument) {
    return fallback;
  }

  const value = Number.parseInt(argument.slice(prefix.length), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const iterations = readPositiveInteger("iterations", DEFAULT_ITERATIONS);
const keyCount = Math.min(readPositiveInteger("keys", DEFAULT_KEYS), iterations);

// Ensure an externally inherited setting cannot accidentally disable the
// benchmark. The process exits after this script, so no application state is
// changed outside this synthetic run.
process.env.RATE_LIMIT_ENABLED = "true";
clearRateLimitBuckets();

let allowed = 0;
const startedAt = performance.now();

for (let i = 0; i < iterations; i += 1) {
  // Fill a large live set first, then advance beyond the idle TTL so cleanup
  // must discard expired entries through the expiry index.
  const now = i < keyCount ? BASE_NOW : BASE_NOW + IDLE_TTL_MS + 1;
  const result = consumeRateLimit("performance-benchmark", `key-${i % keyCount}`, 1, 60_000, now);
  if (result.allowed) {
    allowed += 1;
  }
}

const elapsedMs = performance.now() - startedAt;
console.log(
  JSON.stringify({
    benchmark: "in-process-rate-limit-expiry",
    iterations,
    keys: keyCount,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    operationsPerSecond: Math.round((iterations / elapsedMs) * 1_000),
    allowed,
    externalCalls: 0,
  }),
);
