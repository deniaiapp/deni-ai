import { expect, test } from "vitest";
import { toSafeRedirectPath } from "./auth-redirect";

test("keeps same-origin post-auth paths with their query and hash", () => {
  expect(toSafeRedirectPath("/chat")).toBe("/chat");
  expect(toSafeRedirectPath("/account/settings?error=TOKEN_EXPIRED#top")).toBe(
    "/account/settings?error=TOKEN_EXPIRED#top",
  );
  expect(toSafeRedirectPath("/chat/../account/settings")).toBe("/account/settings");
});

test.each([
  "https://evil.example/login",
  "//evil.example",
  "/\\evil.example",
  "/\t/evil.example",
  "/.//evil.example",
  "/.//evil.example/login",
  "/%2e//evil.example",
  "/%2E//evil.example",
  "/chat/..//evil.example",
  "/a/b/../..//evil.example",
  "/./\\evil.example",
  "@evil.example",
  "javascript:alert(1)",
  "chat",
  "",
  null,
  undefined,
])("rejects %j as a post-auth destination", (value) => {
  expect(toSafeRedirectPath(value)).toBe("/chat");
  expect(toSafeRedirectPath(value, "/home")).toBe("/home");
});
