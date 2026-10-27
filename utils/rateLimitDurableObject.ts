/**
 * Durable Object backing the rate limiter on Cloudflare Workers.
 *
 * One instance per `${scope}:${key}` (via `idFromName`), so each instance owns
 * exactly one fixed-window bucket. Workers isolates share no memory; routing
 * every request for a key to the same object gives a globally consistent count.
 *
 * Deliberately a plain class (no `extends DurableObject` from
 * "cloudflare:workers") so Node can still import and typecheck the app. The
 * Workers runtime accepts any class with `constructor(state, env)` + `fetch`.
 *
 * Protocol: `POST /consume` with JSON `{ max, windowMs }`; responds with a
 * `RateLimitResult` JSON body. The DO's own clock is authoritative.
 */

import type { DurableObjectState } from "@cloudflare/workers-types";
import {
  applyFixedWindow,
  type RateLimitBucket,
  type RateLimitResult,
} from "./rateLimit";

const BUCKET_STORAGE_KEY = "bucket";

export type RateLimitConsumeRequest = {
  max: number;
  windowMs: number;
};

/** Minimal surface of `DurableObjectState` this class uses (eases testing). */
export type RateLimiterState = Pick<
  DurableObjectState,
  "blockConcurrencyWhile"
> & {
  storage: Pick<
    DurableObjectState["storage"],
    "get" | "put" | "deleteAll" | "setAlarm"
  >;
};

function isConsumeRequest(value: unknown): value is RateLimitConsumeRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.max === "number" &&
    Number.isFinite(v.max) &&
    typeof v.windowMs === "number" &&
    Number.isFinite(v.windowMs)
  );
}

export class RateLimiterDO {
  private bucket: RateLimitBucket | undefined;
  private readonly ready: Promise<void>;

  constructor(
    private readonly state: RateLimiterState | DurableObjectState,
    _env: unknown,
  ) {
    // Restore the bucket after eviction so long windows (admin login: 15m)
    // survive the object being unloaded between requests.
    this.ready = state.blockConcurrencyWhile(async () => {
      this.bucket = await state.storage.get<RateLimitBucket>(BUCKET_STORAGE_KEY);
    });
  }

  /** Core logic, exposed for tests. Synchronous after `ready` resolves. */
  async consume(
    max: number,
    windowMs: number,
    now = Date.now(),
  ): Promise<RateLimitResult> {
    await this.ready;
    if (max < 1 || windowMs < 1) {
      // Mirrors the in-memory limiter: a non-positive limit disables limiting.
      return {
        allowed: true,
        limit: max,
        remaining: max,
        resetAt: Math.ceil((now + windowMs) / 1000),
        retryAfterSec: 0,
      };
    }
    const { bucket, result, isNewWindow } = applyFixedWindow(
      this.bucket,
      max,
      windowMs,
      now,
    );
    this.bucket = bucket;

    // Output gates hold the response until these writes are durable; awaiting
    // just surfaces storage errors to the caller (which then fails open).
    await this.state.storage.put(BUCKET_STORAGE_KEY, bucket);
    if (isNewWindow) {
      // Garbage-collect the bucket once its window has elapsed.
      await this.state.storage.setAlarm(bucket.windowStart + windowMs);
    }
    return result;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    if (!isConsumeRequest(body)) {
      return new Response("Bad Request", { status: 400 });
    }
    const result = await this.consume(body.max, body.windowMs);
    return Response.json(result);
  }

  /** Alarm handler: drop the bucket once its window is over (bounded storage). */
  async alarm(): Promise<void> {
    await this.clearIfExpired(Date.now());
  }

  /** Exposed for tests; `alarm()` receives runtime alarm info, not a clock. */
  async clearIfExpired(now: number): Promise<void> {
    await this.ready;
    const bucket = this.bucket;
    // A newer window may have re-armed the alarm; only clear stale state.
    if (!bucket || now >= bucket.windowStart + bucket.windowMs) {
      this.bucket = undefined;
      await this.state.storage.deleteAll();
    }
  }
}
