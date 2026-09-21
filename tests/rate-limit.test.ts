import { describe, expect, test, beforeEach, afterEach } from "bun:test";
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
  const originalProxies = Bun.env.TRUSTED_PROXY_IPS;
  const originalHeader = Bun.env.CLIENT_IP_HEADER;
  beforeEach(() => {
    delete Bun.env.TRUSTED_PROXY_IPS;
    delete Bun.env.CLIENT_IP_HEADER;
  });
  afterEach(() => {
    if (originalProxies === undefined) delete Bun.env.TRUSTED_PROXY_IPS;
    else Bun.env.TRUSTED_PROXY_IPS = originalProxies;
    if (originalHeader === undefined) delete Bun.env.CLIENT_IP_HEADER;
    else Bun.env.CLIENT_IP_HEADER = originalHeader;
  });

  test("ignores spoofed headers on direct connections", () => {
    const headers = new Headers({ "cf-connecting-ip": "10.0.0.1", "x-real-ip": "10.0.0.2", "x-forwarded-for": "10.0.0.3" });
    expect(getClientIp(headers, "203.0.113.5")).toBe("203.0.113.5");
    expect(getClientIp(headers)).toBe("unknown");
  });

  test("uses the nearest untrusted hop, not a forged first XFF entry", () => {
    Bun.env.TRUSTED_PROXY_IPS = "10.0.0.0/8";
    expect(getClientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.5, 10.0.0.2" }), "10.0.0.1")).toBe("203.0.113.5");
    expect(getClientIp(new Headers(), "10.0.0.1")).toBe("10.0.0.1");
  });

  test("single-address headers require a trusted peer and explicit configuration", () => {
    Bun.env.TRUSTED_PROXY_IPS = "10.0.0.1";
    const headers = new Headers({ "cf-connecting-ip": "203.0.113.5" });
    expect(getClientIp(headers, "10.0.0.1")).toBe("10.0.0.1");
    Bun.env.CLIENT_IP_HEADER = "cf-connecting-ip";
    expect(getClientIp(headers, "10.0.0.1")).toBe("203.0.113.5");
    expect(getClientIp(headers, "203.0.113.6")).toBe("203.0.113.6");
  });

  test("supports IPv6 and IPv4-mapped peers and rejects malformed headers", () => {
    Bun.env.TRUSTED_PROXY_IPS = "2001:db8::/32,127.0.0.1";
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5" });
    expect(getClientIp(headers, "2001:db8::1")).toBe("203.0.113.5");
    expect(getClientIp(headers, "::ffff:127.0.0.1")).toBe("203.0.113.5");
    expect(getClientIp(new Headers({ "x-forwarded-for": "garbage,203.0.113.5" }), "127.0.0.1")).toBe("127.0.0.1");
  });
});
