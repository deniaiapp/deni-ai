import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  extractApiKey,
  extractApiKeyFromHeaders,
  redactApiKey,
  redactApiKeyFromHeaders,
  summarizeRequestAuth,
} from "../utils/deni/auth";

describe("extractApiKey", () => {
  test("prefers x-api-key over Authorization", () => {
    assert.equal(extractApiKey("Bearer ignored", "deni_from_header"), "deni_from_header");
  });

  test("reads Bearer tokens and ignores Basic", () => {
    assert.equal(extractApiKey("Bearer deni_abc", undefined), "deni_abc");
    assert.equal(extractApiKey("Bearer   deni_abc  ", undefined), "deni_abc");
    assert.equal(extractApiKey("bearer deni_abc", undefined), "deni_abc");
    assert.equal(extractApiKey("deni_raw_without_scheme", undefined), "deni_raw_without_scheme");
    assert.equal(extractApiKey("Basic dXNlcjpwYXNz", undefined), null);
    assert.equal(extractApiKey("Bearer ", undefined), null);
    assert.equal(extractApiKey(undefined, undefined), null);
  });
});

describe("extractApiKeyFromHeaders", () => {
  test("reads api-key and x-openai-api-key when Authorization is missing", () => {
    assert.equal(
      extractApiKeyFromHeaders(new Headers({ "api-key": "deni_from_api_key" })),
      "deni_from_api_key",
    );
    assert.equal(
      extractApiKeyFromHeaders(
        new Headers({ "x-openai-api-key": "deni_from_openai" }),
      ),
      "deni_from_openai",
    );
  });
});

describe("summarizeRequestAuth", () => {
  test("reports header presence without exposing the secret", () => {
    const raw = "deni_abcdefghijklmnopqrstuvwxyz012345";
    const summary = summarizeRequestAuth(
      new Headers({ Authorization: `Bearer ${raw}` }),
    );
    assert.deepEqual(summary, {
      hasAuthorization: true,
      authorizationScheme: "Bearer",
      hasXApiKey: false,
      hasApiKey: false,
      hasOpenaiApiKey: false,
    });
    assert.ok(!JSON.stringify(summary).includes(raw));
  });
});

describe("redactApiKey", () => {
  test("returns a prefix…suffix fingerprint and never the full secret", () => {
    const raw = "deni_abcdefghijklmnopqrstuvwxyz012345";
    assert.equal(redactApiKey(raw), "deni_abc…2345");
    assert.equal(redactApiKey(raw)?.includes("defghijklmnopqrstuvwxyz01"), false);
  });

  test("short or missing keys stay unusable", () => {
    assert.equal(redactApiKey(null), null);
    assert.equal(redactApiKey(""), null);
    assert.equal(redactApiKey("shortkey"), "shor…");
  });
});

describe("redactApiKeyFromHeaders", () => {
  test("redacts Bearer and x-api-key the same way", () => {
    const raw = "deni_abcdefghijklmnopqrstuvwxyz012345";
    assert.equal(redactApiKeyFromHeaders(`Bearer ${raw}`, undefined), "deni_abc…2345");
    assert.equal(redactApiKeyFromHeaders(undefined, raw), "deni_abc…2345");
    assert.equal(redactApiKeyFromHeaders("Basic dXNlcjpwYXNz", undefined), null);
  });
});
