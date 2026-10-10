import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import {
  clearRateLimitBuckets,
  configureDurableRateLimit,
  consumeRateLimitAsync,
} from "../utils/rateLimit";
import {
  RateLimiterDO,
  type RateLimiterState,
} from "../utils/rateLimitDurableObject";

function fakeState(initial: Map<string, unknown> = new Map()) {
  const data = initial;
  const alarms: number[] = [];
  const state = {
    blockConcurrencyWhile: <T>(fn: () => Promise<T>) => fn(),
    storage: {
      get: async (key: string) => data.get(key),
      put: async (key: string, value: unknown) => {
        data.set(key, structuredClone(value));
      },
      deleteAll: async () => {
        data.clear();
      },
      setAlarm: async (at: number | Date) => {
        alarms.push(Number(at));
      },
    },
  } as unknown as RateLimiterState;
  return { state, data, alarms };
}

/** Namespace that routes idFromName(name) to one RateLimiterDO per name. */
function fakeNamespace() {
  const objects = new Map<string, RateLimiterDO>();
  const names: string[] = [];
  const ns = {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      fetch: (url: string, init: RequestInit) => {
        names.push(id.name);
        let obj = objects.get(id.name);
        if (!obj) {
          obj = new RateLimiterDO(fakeState().state, {});
          objects.set(id.name, obj);
        }
        return obj.fetch(new Request(url, init));
      },
    }),
  } as unknown as DurableObjectNamespace;
  return { ns, names };
}

beforeEach(() => {
  clearRateLimitBuckets();
  delete process.env.RATE_LIMIT_ENABLED;
  delete process.env.FLIXA_AUTH_DISABLED;
});
afterEach(() => {
  configureDurableRateLimit(null);
});

describe("RateLimiterDO", () => {
  test("enforces fixed window and resets", async () => {
    const { state, alarms } = fakeState();
    const obj = new RateLimiterDO(state, {});
    const now = 1_000_000;
    expect((await obj.consume(2, 1_000, now)).remaining).toBe(1);
    expect((await obj.consume(2, 1_000, now + 1)).remaining).toBe(0);
    const blocked = await obj.consume(2, 1_000, now + 2);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect((await obj.consume(2, 1_000, now + 1_000)).allowed).toBe(true);
    expect(alarms).toEqual([now + 1_000, now + 2_000]);
  });

  test("restores bucket from storage after eviction and clears on alarm", async () => {
    const { state, data } = fakeState();
    const now = 2_000_000;
    await new RateLimiterDO(state, {}).consume(1, 60_000, now);
    const revived = new RateLimiterDO(state, {});
    expect((await revived.consume(1, 60_000, now + 5)).allowed).toBe(false);

    await revived.clearIfExpired(now + 10);
    expect(data.size).toBe(1);
    await revived.clearIfExpired(now + 60_000);
    expect(data.size).toBe(0);
    expect((await revived.consume(1, 60_000, now + 60_001)).allowed).toBe(true);
  });

  test("fetch protocol validates input", async () => {
    const obj = new RateLimiterDO(fakeState().state, {});
    const bad = await obj.fetch(
      new Request("https://x/consume", { method: "POST", body: "{}" }),
    );
    expect(bad.status).toBe(400);
    const ok = await obj.fetch(
      new Request("https://x/consume", {
        method: "POST",
        body: JSON.stringify({ max: 3, windowMs: 1_000 }),
      }),
    );
    expect(await ok.json()).toMatchObject({ allowed: true, limit: 3, remaining: 2 });
  });
});

describe("consumeRateLimitAsync with durable backend", () => {
  test("routes per scope:key and shares counts", async () => {
    const { ns, names } = fakeNamespace();
    configureDurableRateLimit(ns);
    expect((await consumeRateLimitAsync("ip", "1.1.1.1", 1, 60_000)).allowed).toBe(true);
    expect((await consumeRateLimitAsync("ip", "1.1.1.1", 1, 60_000)).allowed).toBe(false);
    expect((await consumeRateLimitAsync("user", "1.1.1.1", 1, 60_000)).allowed).toBe(true);
    expect(names).toEqual(["ip:1.1.1.1", "ip:1.1.1.1", "user:1.1.1.1"]);
  });

  test("skips the DO when disabled via env", async () => {
    const { ns, names } = fakeNamespace();
    configureDurableRateLimit(ns);
    process.env.RATE_LIMIT_ENABLED = "false";
    for (let i = 0; i < 3; i++) {
      expect((await consumeRateLimitAsync("t", "k", 1, 60_000)).allowed).toBe(true);
    }
    expect(names).toEqual([]);
  });

  test("fails open and logs when the DO throws", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    configureDurableRateLimit({
      idFromName: () => ({}),
      get: () => ({
        fetch: async () => {
          throw new Error("boom");
        },
      }),
    } as unknown as DurableObjectNamespace);
    try {
      for (let i = 0; i < 3; i++) {
        expect((await consumeRateLimitAsync("t", "k", 1, 60_000)).allowed).toBe(true);
      }
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]![0])).toContain("[RateLimit]");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
