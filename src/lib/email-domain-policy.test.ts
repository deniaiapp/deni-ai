import { describe, expect, test } from "vitest";
import {
  ALLOWED_EMAIL_PROVIDERS,
  checkSignupEmail,
  isAliasLikeLocalPart,
  isAllowedEmailProviderDomain,
  isRandomLookingLocalPart,
} from "./email-domain-policy";

describe("signup local parts", () => {
  test.each(["taro1990", "yamada2001", "muxjcx87394v", "TARO1990"])(
    "%s uses verification rather than alias rejection",
    (local) => {
      expect(isAliasLikeLocalPart(local)).toBe(false);
      expect(isRandomLookingLocalPart(local)).toBe(true);
      expect(checkSignupEmail(`${local}@outlook.com`)).toEqual({ ok: true });
      expect(checkSignupEmail(`${local}@u-tokyo.ac.jp`)).toEqual({ ok: true });
    },
  );
  test.each(["user+tag", "e.l.adu.v.a.r.61.5", "a.b.c.d", "a..b", ".name", "name."])(
    "%s remains an alias rejection",
    (local) => {
      expect(isAliasLikeLocalPart(local)).toBe(true);
      expect(checkSignupEmail(`${local}@icloud.com`)).toEqual({
        ok: false,
        reason: "alias_not_allowed",
      });
    },
  );
  test.each(["john.doe", "j.doe", "jane_smith", "taro_1990", "taro.1990"])(
    "%s remains an ordinary mailbox",
    (local) => {
      expect(isAliasLikeLocalPart(local)).toBe(false);
      expect(isRandomLookingLocalPart(local)).toBe(false);
    },
  );
  test("provider policy still applies to advisory local parts", () => {
    expect(checkSignupEmail("taro1990@gmail.com")).toEqual({
      ok: false,
      reason: "use_google_oauth",
    });
    expect(checkSignupEmail("taro1990@example.com")).toEqual({ ok: false, reason: "not_allowed" });
  });
});

describe("duck.com forwarding addresses", () => {
  test("are not an allowed provider", () => {
    expect(ALLOWED_EMAIL_PROVIDERS.has("duck.com")).toBe(false);
    expect(isAllowedEmailProviderDomain("duck.com")).toBe(false);
    expect(isAllowedEmailProviderDomain("DUCK.COM")).toBe(false);
  });

  test.each(["person@duck.com", "Person@Duck.COM", " person@duck.com. ", "a1b2c3@duck.com"])(
    "%s is rejected for email registration",
    (email) => {
      expect(checkSignupEmail(email)).toEqual({ ok: false, reason: "not_allowed" });
    },
  );

  test.each(["google", "github"] as const)("are rejected for %s registration", (provider) => {
    expect(checkSignupEmail("person@duck.com", provider)).toEqual({
      ok: false,
      reason: "not_allowed",
    });
  });

  test("other privacy-focused mailboxes stay allowed", () => {
    for (const email of ["person@proton.me", "person@hey.com", "person@tuta.com"]) {
      expect(checkSignupEmail(email)).toEqual({ ok: true });
    }
  });
});
