import { describe, expect, test } from "bun:test";
import {
  extractApiKey,
  extractApiKeyFromHeaders,
  redactApiKey,
  redactApiKeyFromHeaders,
  summarizeRequestAuth,
} from "../utils/deni/auth";

describe("extractApiKey", () => {
  test("prefers x-api-key over Authorization", () => {
    expect(extractApiKey("Bearer ignored", "deni_from_header")).toBe(
      "deni_from_header",
    );
  });

  test("reads Bearer tokens and ignores Basic", () => {
    expect(extractApiKey("Bearer deni_abc", undefined)).toBe("deni_abc");
    expect(extractApiKey("Bearer   deni_abc  ", undefined)).toBe("deni_abc");
    expect(extractApiKey("bearer deni_abc", undefined)).toBe("deni_abc");
    expect(extractApiKey("deni_raw_without_scheme", undefined)).toBe(
      "deni_raw_without_scheme",
    );
    expect(extractApiKey("Basic dXNlcjpwYXNz", undefined)).toBeNull();
    expect(extractApiKey("Bearer ", undefined)).toBeNull();
    expect(extractApiKey(undefined, undefined)).toBeNull();
  });
});

describe("extractApiKeyFromHeaders", () => {
  test("reads api-key and x-openai-api-key when Authorization is missing", () => {
    expect(
      extractApiKeyFromHeaders(new Headers({ "api-key": "deni_from_api_key" })),
    ).toBe("deni_from_api_key");
    expect(
      extractApiKeyFromHeaders(
        new Headers({ "x-openai-api-key": "deni_from_openai" }),
      ),
    ).toBe("deni_from_openai");
  });
});

describe("summarizeRequestAuth", () => {
  test("reports header presence without exposing the secret", () => {
    const raw = "deni_abcdefghijklmnopqrstuvwxyz012345";
    const summary = summarizeRequestAuth(
      new Headers({ Authorization: `Bearer ${raw}` }),
    );
    expect(summary).toEqual({
      hasAuthorization: true,
      authorizationScheme: "Bearer",
      hasXApiKey: false,
      hasApiKey: false,
      hasOpenaiApiKey: false,
    });
    expect(JSON.stringify(summary)).not.toContain(raw);
  });
});

describe("redactApiKey", () => {
  test("returns a prefix…suffix fingerprint and never the full secret", () => {
    const raw = "deni_abcdefghijklmnopqrstuvwxyz012345";
    expect(redactApiKey(raw)).toBe("deni_abc…2345");
    expect(redactApiKey(raw)?.includes("defghijklmnopqrstuvwxyz01")).toBe(
      false,
    );
  });

  test("short or missing keys stay unusable", () => {
    expect(redactApiKey(null)).toBeNull();
    expect(redactApiKey("")).toBeNull();
    expect(redactApiKey("shortkey")).toBe("shor…");
  });
});

describe("redactApiKeyFromHeaders", () => {
  test("redacts Bearer and x-api-key the same way", () => {
    const raw = "deni_abcdefghijklmnopqrstuvwxyz012345";
    expect(redactApiKeyFromHeaders(`Bearer ${raw}`, undefined)).toBe(
      "deni_abc…2345",
    );
    expect(redactApiKeyFromHeaders(undefined, raw)).toBe("deni_abc…2345");
    expect(redactApiKeyFromHeaders("Basic dXNlcjpwYXNz", undefined)).toBeNull();
  });
});
