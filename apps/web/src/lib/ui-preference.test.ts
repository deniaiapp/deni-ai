import { describe, expect, test, vi } from "vitest";

vi.mock("@tanstack/react-start/server", () => ({ getCookie: vi.fn() }));

const { parseUiPreference, readCookieValue, serializeUiPreferenceCookie, UI_PREFERENCE_COOKIE } =
  await import("./ui-preference");

describe("parseUiPreference", () => {
  test("defaults to the next UI", () => {
    expect(parseUiPreference(undefined)).toBe("next");
    expect(parseUiPreference(null)).toBe("next");
    expect(parseUiPreference("")).toBe("next");
  });

  test("keeps a known value", () => {
    expect(parseUiPreference("legacy")).toBe("legacy");
    expect(parseUiPreference("next")).toBe("next");
  });

  test("ignores unknown or differently cased values", () => {
    expect(parseUiPreference("LEGACY")).toBe("next");
    expect(parseUiPreference("old")).toBe("next");
  });
});

describe("readCookieValue", () => {
  test("finds the cookie among others", () => {
    expect(readCookieValue(`a=1; ${UI_PREFERENCE_COOKIE}=legacy; b=2`, UI_PREFERENCE_COOKIE)).toBe(
      "legacy",
    );
  });

  test("does not match a cookie whose name only ends with the name", () => {
    expect(readCookieValue(`x-${UI_PREFERENCE_COOKIE}=legacy`, UI_PREFERENCE_COOKIE)).toBe(
      undefined,
    );
  });

  test("tolerates malformed encoding", () => {
    expect(readCookieValue(`${UI_PREFERENCE_COOKIE}=%E0%A4%A`, UI_PREFERENCE_COOKIE)).toBe(
      undefined,
    );
  });
});

describe("serializeUiPreferenceCookie", () => {
  test("stores the value site-wide for a year", () => {
    expect(serializeUiPreferenceCookie("legacy")).toBe(
      `${UI_PREFERENCE_COOKIE}=legacy; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
  });

  test("marks the cookie Secure on HTTPS", () => {
    expect(serializeUiPreferenceCookie("next", { secure: true })).toMatch(/; Secure$/);
  });

  test("round-trips through readCookieValue", () => {
    const [pair] = serializeUiPreferenceCookie("legacy").split("; ");
    expect(parseUiPreference(readCookieValue(pair, UI_PREFERENCE_COOKIE))).toBe("legacy");
  });
});
