import { describe, expect, test, beforeEach } from "bun:test";
import {
  clearRateLimitBuckets,
  consumeRateLimit,
  getClientIp,
  isAgentInferencePath,
} from "../utils/rateLimit";

describe("consumeRateLimit", () => {
  beforeEach(() => {
    clearRateLimitBuckets();
    delete Bun.env.RATE_LIMIT_ENABLED;
    delete Bun.env.FLIXA_AUTH_DISABLED;
  });

  test("allows up to max requests in a window then blocks", () => {
    const now = 1_000_000;
    const max = 3;
    const windowMs = 60_000;

    for (let i = 0; i < max; i++) {
      const r = consumeRateLimit("t", "user-a", max, windowMs, now + i);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(max - (i + 1));
      expect(r.limit).toBe(max);
    }

    const blocked = consumeRateLimit("t", "user-a", max, windowMs, now + max);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  test("isolates keys and scopes", () => {
    const now = 2_000_000;
    expect(
      consumeRateLimit("ip", "1.1.1.1", 1, 60_000, now).allowed,
    ).toBe(true);
    expect(
      consumeRateLimit("ip", "1.1.1.1", 1, 60_000, now + 1).allowed,
    ).toBe(false);
    expect(
      consumeRateLimit("ip", "2.2.2.2", 1, 60_000, now + 2).allowed,
    ).toBe(true);
    expect(
      consumeRateLimit("user", "1.1.1.1", 1, 60_000, now + 3).allowed,
    ).toBe(true);
  });

  test("resets after the window elapses", () => {
    const now = 3_000_000;
    const windowMs = 1_000;
    expect(consumeRateLimit("t", "k", 1, windowMs, now).allowed).toBe(true);
    expect(consumeRateLimit("t", "k", 1, windowMs, now + 10).allowed).toBe(
      false,
    );
    expect(
      consumeRateLimit("t", "k", 1, windowMs, now + windowMs).allowed,
    ).toBe(true);
  });

  test("can be disabled via env", () => {
    Bun.env.RATE_LIMIT_ENABLED = "false";
    const now = 4_000_000;
    for (let i = 0; i < 20; i++) {
      expect(consumeRateLimit("t", "spam", 1, 60_000, now + i).allowed).toBe(
        true,
      );
    }
  });

  test("is bypassed by auth-disabled mode", () => {
    Bun.env.FLIXA_AUTH_DISABLED = "true";
    const now = 5_000_000;
    for (let i = 0; i < 20; i++) {
      expect(
        consumeRateLimit("t", "auth-disabled", 1, 60_000, now + i).allowed,
      ).toBe(true);
    }
  });
});

describe("isAgentInferencePath", () => {
  test("matches chat completions / responses / messages only", () => {
    expect(isAgentInferencePath("/v1/agent/chat/completions")).toBe(true);
    expect(isAgentInferencePath("/v1/agent/responses")).toBe(true);
    expect(isAgentInferencePath("/v1/agent/responses/compact")).toBe(true);
    expect(isAgentInferencePath("/v1/messages")).toBe(true);
    expect(isAgentInferencePath("/v1/agent/messages")).toBe(true);
    expect(isAgentInferencePath("/v1/agent/v1/messages")).toBe(true);
    expect(isAgentInferencePath("/v1/agent/chat/completions/")).toBe(true);

    expect(isAgentInferencePath("/v1/models")).toBe(false);
    expect(isAgentInferencePath("/v1/deni/usage")).toBe(false);
    expect(isAgentInferencePath("/health")).toBe(false);
  });
});

describe("getClientIp", () => {
  test("prefers cf-connecting-ip, then x-real-ip, then first x-forwarded-for", () => {
    expect(
      getClientIp(
        new Headers({
          "cf-connecting-ip": "10.0.0.1",
          "x-real-ip": "10.0.0.2",
          "x-forwarded-for": "10.0.0.3, 10.0.0.4",
        }),
      ),
    ).toBe("10.0.0.1");

    expect(
      getClientIp(
        new Headers({
          "x-real-ip": "10.0.0.2",
          "x-forwarded-for": "10.0.0.3, 10.0.0.4",
        }),
      ),
    ).toBe("10.0.0.2");

    expect(
      getClientIp(new Headers({ "x-forwarded-for": "10.0.0.3, 10.0.0.4" })),
    ).toBe("10.0.0.3");

    expect(getClientIp(new Headers(), "fallback")).toBe("fallback");
  });
});
