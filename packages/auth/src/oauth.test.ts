import { describe, expect, it } from "vitest";

import { hashOAuthToken, OAUTH_SCOPES, parseBearerToken } from "./oauth";

describe("hashOAuthToken", () => {
  it("matches the oauth provider's default SHA-256 base64url hash", async () => {
    // echo -n abc | openssl dgst -sha256 -binary | basenc --base64url
    expect(await hashOAuthToken("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });
});

describe("parseBearerToken", () => {
  it("reads the token of a bearer header", () => {
    expect(parseBearerToken("Bearer abc.DEF-123_~+/=")).toBe("abc.DEF-123_~+/=");
    expect(parseBearerToken("bearer  token")).toBe("token");
  });

  it("rejects other schemes and malformed values", () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(parseBearerToken("Bearer")).toBeNull();
    expect(parseBearerToken("Bearer a b")).toBeNull();
  });
});

describe("OAUTH_SCOPES", () => {
  it("keeps the plugin defaults so existing clients are unaffected", () => {
    expect(OAUTH_SCOPES).toEqual(
      expect.arrayContaining(["openid", "profile", "email", "offline_access"]),
    );
  });
});
