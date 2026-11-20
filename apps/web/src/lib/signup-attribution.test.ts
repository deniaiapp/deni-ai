import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";
import {
  parseSignupAttribution,
  SIGNUP_ATTRIBUTION_BOOT_SCRIPT,
  SIGNUP_ATTRIBUTION_COOKIE,
} from "./signup-attribution";

const cookie = (value: unknown) =>
  `other=1; ${SIGNUP_ATTRIBUTION_COOKIE}=${encodeURIComponent(JSON.stringify(value))}; theme=dark`;

/** Runs the boot script against a minimal browser and returns the cookie it wrote. */
function boot({
  url,
  referrer = "",
  existingCookie = "",
}: {
  url: string;
  referrer?: string;
  existingCookie?: string;
}) {
  const written: string[] = [];
  const document = {
    referrer,
    get cookie() {
      return existingCookie;
    },
    set cookie(value: string) {
      written.push(value);
    },
  };
  runInNewContext(SIGNUP_ATTRIBUTION_BOOT_SCRIPT, {
    document,
    location: new URL(url),
    URL,
    URLSearchParams,
    encodeURIComponent,
    JSON,
    String,
  });
  return written.at(0) ?? null;
}

test("reads the UTM parameters, referrer and landing path of the first visit", () => {
  expect(
    parseSignupAttribution(cookie({ s: "x", m: "social", c: "launch", r: "T.co", p: "/ja/home" })),
  ).toEqual({
    utmSource: "x",
    utmMedium: "social",
    utmCampaign: "launch",
    referrerHost: "t.co",
    landingPath: "/ja/home",
  });
});

test("keeps a referrer-only visit and turns empty fields into null", () => {
  expect(parseSignupAttribution(cookie({ s: "", m: "", c: "", r: "t.co", p: "/" }))).toEqual({
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    referrerHost: "t.co",
    landingPath: "/",
  });
});

test("bounds and cleans visitor-controlled values", () => {
  const result = parseSignupAttribution(
    cookie({ s: `x\u0000${"a".repeat(500)}`, r: 42, p: "https://evil.example/" }),
  );
  expect(result?.utmSource).toHaveLength(100);
  expect(result?.utmSource).not.toContain("\u0000");
  expect(result?.referrerHost).toBeNull();
  expect(result?.landingPath).toBeNull();
});

test("returns null without a cookie, for malformed values and for a visit with no source", () => {
  expect(parseSignupAttribution(null)).toBeNull();
  expect(parseSignupAttribution("theme=dark")).toBeNull();
  expect(parseSignupAttribution(`${SIGNUP_ATTRIBUTION_COOKIE}=%7Bnot-json`)).toBeNull();
  expect(parseSignupAttribution(`${SIGNUP_ATTRIBUTION_COOKIE}=%E0%A4%A`)).toBeNull();
  expect(parseSignupAttribution(cookie("x"))).toBeNull();
  expect(parseSignupAttribution(cookie({ p: "/home" }))).toBeNull();
});

test("the boot script writes a cookie the server can read back", () => {
  const written = boot({
    url: "https://deniai.app/ja/home?utm_source=x&utm_campaign=launch",
    referrer: "https://t.co/abc",
  });
  expect(written).toContain("max-age=2592000");
  expect(written).toContain("samesite=lax");
  expect(written).toContain(";secure");
  expect(parseSignupAttribution(written?.split(";")[0])).toEqual({
    utmSource: "x",
    utmMedium: null,
    utmCampaign: "launch",
    referrerHost: "t.co",
    landingPath: "/ja/home",
  });
});

test("the boot script keeps the first touch and ignores visits with no source", () => {
  expect(
    boot({
      url: "https://deniai.app/home?utm_source=later",
      existingCookie: `theme=dark; ${SIGNUP_ATTRIBUTION_COOKIE}=%7B%7D`,
    }),
  ).toBeNull();
  expect(boot({ url: "https://deniai.app/home" })).toBeNull();
  // Same-site navigation and the return from Google sign-in are not referrals.
  expect(boot({ url: "https://deniai.app/chat", referrer: "https://deniai.app/home" })).toBeNull();
  expect(
    boot({ url: "https://deniai.app/chat", referrer: "https://accounts.google.com/o/oauth2" }),
  ).toBeNull();
});
