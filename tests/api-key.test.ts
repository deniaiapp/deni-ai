import { describe, expect, test } from "bun:test";
import {
  extractApiKey,
  redactApiKey,
  redactApiKeyFromHeaders,
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
    expect(extractApiKey("Basic dXNlcjpwYXNz", undefined)).toBeNull();
    expect(extractApiKey("Bearer ", undefined)).toBeNull();
    expect(extractApiKey(undefined, undefined)).toBeNull();
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
