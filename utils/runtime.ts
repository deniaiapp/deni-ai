import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool } from "pg";

/**
 * Per-request runtime hooks. Only populated on Cloudflare Workers (see
 * worker.ts); on Bun every helper falls back to process-wide behaviour.
 */
export type RequestRuntime = {
  waitUntil(promise: Promise<unknown>): void;
  /** Workers cannot share sockets across requests, so the pool is per request. */
  pool?: Pool;
};

const requestRuntime = new AsyncLocalStorage<RequestRuntime>();

export function runWithRequestRuntime<T>(runtime: RequestRuntime, fn: () => T): T {
  return requestRuntime.run(runtime, fn);
}

export function getRequestRuntime(): RequestRuntime | undefined {
  return requestRuntime.getStore();
}

/** Keep background work alive after the response (Workers) or just let it run (Bun). */
export function keepAlive(promise: Promise<unknown>): void {
  requestRuntime.getStore()?.waitUntil(promise.catch(() => {}));
}
