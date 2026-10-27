import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  clearRateLimitBuckets,
  consumeRateLimit,
  getClientIp,
  isAgentInferencePath,
} from "../utils/rateLimit";

describe("consumeRateLimit", () => {
  beforeEach(() => {
    clearRateLimitBuckets();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.FLIXA_AUTH_DISABLED;
  });

  test("allows up to max requests in a window then blocks", () => {
    const now = 1_000_000;
    const max = 3;
    const windowMs = 60_000;

    for (let i = 0; i < max; i++) {
      const r = consumeRateLimit("t", "user-a", max, windowMs, now + i);
      assert.equal(r.allowed, true);
      assert.equal(r.remaining, max - (i + 1));
      assert.equal(r.limit, max);
    }

    const blocked = consumeRateLimit("t", "user-a", max, windowMs, now + max);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(blocked.retryAfterSec > 0);
  });

  test("isolates keys and scopes", () => {
    const now = 2_000_000;
    assert.equal(consumeRateLimit("ip", "1.1.1.1", 1, 60_000, now).allowed, true);
    assert.equal(consumeRateLimit("ip", "1.1.1.1", 1, 60_000, now + 1).allowed, false);
    assert.equal(consumeRateLimit("ip", "2.2.2.2", 1, 60_000, now + 2).allowed, true);
    assert.equal(consumeRateLimit("user", "1.1.1.1", 1, 60_000, now + 3).allowed, true);
  });

  test("resets after the window elapses", () => {
    const now = 3_000_000;
    const windowMs = 1_000;
    assert.equal(consumeRateLimit("t", "k", 1, windowMs, now).allowed, true);
    assert.equal(consumeRateLimit("t", "k", 1, windowMs, now + 10).allowed, false);
    assert.equal(consumeRateLimit("t", "k", 1, windowMs, now + windowMs).allowed, true);
  });

  test("can be disabled via env", () => {
    process.env.RATE_LIMIT_ENABLED = "false";
    const now = 4_000_000;
    for (let i = 0; i < 20; i++) {
      assert.equal(consumeRateLimit("t", "spam", 1, 60_000, now + i).allowed, true);
    }
  });

  test("is bypassed by auth-disabled mode", () => {
    process.env.FLIXA_AUTH_DISABLED = "true";
    const now = 5_000_000;
    for (let i = 0; i < 20; i++) {
      assert.equal(consumeRateLimit("t", "auth-disabled", 1, 60_000, now + i).allowed, true);
    }
  });
});

describe("isAgentInferencePath", () => {
  test("matches chat completions / responses / messages only", () => {
    assert.equal(isAgentInferencePath("/v1/agent/chat/completions"), true);
    assert.equal(isAgentInferencePath("/v1/agent/responses"), true);
    assert.equal(isAgentInferencePath("/v1/agent/responses/compact"), true);
    assert.equal(isAgentInferencePath("/v1/messages"), true);
    assert.equal(isAgentInferencePath("/v1/agent/messages"), true);
    assert.equal(isAgentInferencePath("/v1/agent/v1/messages"), true);
    assert.equal(isAgentInferencePath("/v1/agent/chat/completions/"), true);

    assert.equal(isAgentInferencePath("/v1/models"), false);
    assert.equal(isAgentInferencePath("/v1/deni/usage"), false);
    assert.equal(isAgentInferencePath("/health"), false);
  });
});

describe("getClientIp", () => {
  const originalProxies = process.env.TRUSTED_PROXY_IPS;
  const originalHeader = process.env.CLIENT_IP_HEADER;
  beforeEach(() => {
    delete process.env.TRUSTED_PROXY_IPS;
    delete process.env.CLIENT_IP_HEADER;
  });
  afterEach(() => {
    if (originalProxies === undefined) delete process.env.TRUSTED_PROXY_IPS;
    else process.env.TRUSTED_PROXY_IPS = originalProxies;
    if (originalHeader === undefined) delete process.env.CLIENT_IP_HEADER;
    else process.env.CLIENT_IP_HEADER = originalHeader;
  });

  test("ignores spoofed headers on direct connections", () => {
    const headers = new Headers({ "cf-connecting-ip": "10.0.0.1", "x-real-ip": "10.0.0.2", "x-forwarded-for": "10.0.0.3" });
    assert.equal(getClientIp(headers, "203.0.113.5"), "203.0.113.5");
    assert.equal(getClientIp(headers), "unknown");
  });

  test("uses the nearest untrusted hop, not a forged first XFF entry", () => {
    process.env.TRUSTED_PROXY_IPS = "10.0.0.0/8";
    assert.equal(
      getClientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.5, 10.0.0.2" }), "10.0.0.1"),
      "203.0.113.5",
    );
    assert.equal(getClientIp(new Headers(), "10.0.0.1"), "10.0.0.1");
  });

  test("single-address headers require a trusted peer and explicit configuration", () => {
    process.env.TRUSTED_PROXY_IPS = "10.0.0.1";
    const headers = new Headers({ "cf-connecting-ip": "203.0.113.5" });
    assert.equal(getClientIp(headers, "10.0.0.1"), "10.0.0.1");
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip";
    assert.equal(getClientIp(headers, "10.0.0.1"), "203.0.113.5");
    assert.equal(getClientIp(headers, "203.0.113.6"), "203.0.113.6");
  });

  test("supports IPv6 and IPv4-mapped peers and rejects malformed headers", () => {
    process.env.TRUSTED_PROXY_IPS = "2001:db8::/32,127.0.0.1";
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5" });
    assert.equal(getClientIp(headers, "2001:db8::1"), "203.0.113.5");
    assert.equal(getClientIp(headers, "::ffff:127.0.0.1"), "203.0.113.5");
    assert.equal(
      getClientIp(new Headers({ "x-forwarded-for": "garbage,203.0.113.5" }), "127.0.0.1"),
      "203.0.113.5",
    );
  });

  test("malformed client-supplied XFF entries do not make the trusted peer the client", () => {
    process.env.TRUSTED_PROXY_IPS = "127.0.0.1,10.0.0.0/8";
    // An appending proxy forwards the client's "not-an-ip" followed by the real client address.
    assert.equal(
      getClientIp(new Headers({ "x-forwarded-for": "not-an-ip, 198.51.100.7" }), "127.0.0.1"),
      "198.51.100.7",
    );
    assert.equal(
      getClientIp(new Headers({ "x-forwarded-for": "not-an-ip, 198.51.100.7, 10.0.0.2" }), "10.0.0.1"),
      "198.51.100.7",
    );
    // A malformed hop where the client address belongs yields no identity.
    assert.equal(
      getClientIp(new Headers({ "x-forwarded-for": "not-an-ip" }), "127.0.0.1"),
      "unknown",
    );
    assert.equal(
      getClientIp(new Headers({ "x-forwarded-for": "198.51.100.7, not-an-ip, 10.0.0.2" }), "10.0.0.1"),
      "unknown",
    );
  });
});
