import { describe, expect, test } from "vitest";
import {
  evaluateTwoFactorPolicy,
  isAllowedWhileTwoFactorRequired,
  parseTwoFactorDeadline,
  type TwoFactorPolicyInput,
} from "./two-factor-policy";

const deadline = new Date("2027-01-15T00:00:00.000Z");
const before = new Date("2027-01-14T23:59:59.000Z");
const after = new Date("2027-01-15T00:00:00.000Z");

function input(overrides: Partial<TwoFactorPolicyInput> = {}): TwoFactorPolicyInput {
  return {
    isAnonymous: false,
    twoFactorEnabled: false,
    providerIds: ["credential"],
    now: before,
    requiredFrom: deadline,
    ...overrides,
  };
}

describe("evaluateTwoFactorPolicy", () => {
  test("a password-only account without 2FA is in grace before the deadline", () => {
    expect(evaluateTwoFactorPolicy(input())).toEqual({
      status: "grace",
      deadline: "2027-01-15T00:00:00.000Z",
    });
  });

  test("it is required from the deadline itself", () => {
    expect(evaluateTwoFactorPolicy(input({ now: after })).status).toBe("required");
  });

  test("without a deadline the grace period never ends", () => {
    expect(
      evaluateTwoFactorPolicy(input({ requiredFrom: null, now: new Date("2099-01-01") })),
    ).toEqual({ status: "grace", deadline: null });
  });

  test("turning 2FA on satisfies the rule, before and after the deadline", () => {
    expect(evaluateTwoFactorPolicy(input({ twoFactorEnabled: true })).status).toBe("satisfied");
    expect(evaluateTwoFactorPolicy(input({ twoFactorEnabled: true, now: after })).status).toBe(
      "satisfied",
    );
  });

  test.each(["google", "github"])("a linked %s account exempts a password account", (provider) => {
    expect(
      evaluateTwoFactorPolicy(input({ providerIds: ["credential", provider], now: after })),
    ).toMatchObject({ status: "exempt", exemptReason: "social-account" });
  });

  test("unlinking the last social account makes the account subject again", () => {
    const linked = evaluateTwoFactorPolicy(
      input({ providerIds: ["credential", "github"], now: after }),
    );
    const unlinked = evaluateTwoFactorPolicy(input({ providerIds: ["credential"], now: after }));
    expect(linked.status).toBe("exempt");
    expect(unlinked.status).toBe("required");
  });

  test("other OAuth providers do not exempt a password account", () => {
    expect(
      evaluateTwoFactorPolicy(input({ providerIds: ["credential", "deni-run"], now: after }))
        .status,
    ).toBe("required");
  });

  test("accounts without a password (magic link or passkey only) are exempt", () => {
    expect(evaluateTwoFactorPolicy(input({ providerIds: [], now: after }))).toMatchObject({
      status: "exempt",
      exemptReason: "no-password",
    });
  });

  test("guests are exempt even with a password account row", () => {
    expect(evaluateTwoFactorPolicy(input({ isAnonymous: true, now: after }))).toMatchObject({
      status: "exempt",
      exemptReason: "guest",
    });
  });
});

describe("parseTwoFactorDeadline", () => {
  test("reads a date as midnight UTC", () => {
    expect(parseTwoFactorDeadline("2027-01-15")?.toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });

  test("reads a date-time with an offset", () => {
    expect(parseTwoFactorDeadline("2027-01-15T09:00:00+09:00")?.toISOString()).toBe(
      "2027-01-15T00:00:00.000Z",
    );
  });

  test.each([undefined, null, "", "  ", "soon", "15/01/2027", "2027-13-45"])(
    "treats %j as no deadline",
    (value) => {
      expect(parseTwoFactorDeadline(value)).toBeNull();
    },
  );
});

describe("isAllowedWhileTwoFactorRequired", () => {
  test.each(["/two-factor/setup", "/account/security"])("allows %s", (path) => {
    expect(isAllowedWhileTwoFactorRequired(path)).toBe(true);
  });

  test.each(["/chat", "/settings/appearance", "/account/settings", "/account/security-x"])(
    "blocks %s",
    (path) => {
      expect(isAllowedWhileTwoFactorRequired(path)).toBe(false);
    },
  );
});
