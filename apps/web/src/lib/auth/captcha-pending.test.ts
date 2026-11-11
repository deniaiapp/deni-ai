import { expect, test } from "vitest";
import { isCaptchaPending } from "./captcha-pending";

const solved = { headers: { "x-captcha-response": "token" } };

test("a form with a configured captcha waits until a token is set", () => {
  expect(isCaptchaPending(true, undefined, "site-key")).toBe(true);
  expect(isCaptchaPending(true, { headers: {} }, "site-key")).toBe(true);
  expect(isCaptchaPending(true, solved, "site-key")).toBe(false);
});

test("nothing waits without a captcha on the form or without Turnstile configured", () => {
  expect(isCaptchaPending(false, undefined, "site-key")).toBe(false);
  expect(isCaptchaPending(true, undefined, undefined)).toBe(false);
  expect(isCaptchaPending(true, undefined, "")).toBe(false);
});
