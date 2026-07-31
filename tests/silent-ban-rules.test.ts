import { describe, expect, test } from "bun:test";
import {
  matchSilentBanCondition,
  matchSilentBanRule,
  resolveSilentBanTarget,
  validateSilentBanConditions,
  type SilentBanCondition,
} from "../utils/deni/silentBanRules";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("resolveSilentBanTarget", () => {
  test("resolves path, method, and headers (with optional header: prefix)", () => {
    const h = headers({ "user-agent": "curl/8.0", "x-client": "bot" });
    expect(resolveSilentBanTarget("path", h, "/v1/agent", "POST")).toBe(
      "/v1/agent",
    );
    expect(resolveSilentBanTarget("method", h, "/v1/agent", "post")).toBe(
      "POST",
    );
    expect(resolveSilentBanTarget("user-agent", h, "/", "GET")).toBe("curl/8.0");
    expect(resolveSilentBanTarget("header:x-client", h, "/", "GET")).toBe(
      "bot",
    );
    expect(resolveSilentBanTarget("missing", h, "/", "GET")).toBeNull();
  });
});

describe("matchSilentBanCondition", () => {
  const path = "/v1/agent/chat/completions";
  const method = "POST";

  test("contains / not_contains on user-agent", () => {
    const h = headers({ "user-agent": "python-requests/2.31.0" });
    expect(
      matchSilentBanCondition(
        { target: "user-agent", op: "contains", value: "python-requests" },
        h,
        path,
        method,
      ),
    ).toBe(true);
    expect(
      matchSilentBanCondition(
        { target: "user-agent", op: "not_contains", value: "python-requests" },
        h,
        path,
        method,
      ),
    ).toBe(false);
    expect(
      matchSilentBanCondition(
        { target: "user-agent", op: "contains", value: "curl" },
        h,
        path,
        method,
      ),
    ).toBe(false);
  });

  test("equals is case-insensitive by default", () => {
    const h = headers({ "x-app": "CLI" });
    expect(
      matchSilentBanCondition(
        { target: "x-app", op: "equals", value: "cli" },
        h,
        path,
        method,
      ),
    ).toBe(true);
    expect(
      matchSilentBanCondition(
        { target: "x-app", op: "equals", value: "cli", caseSensitive: true },
        h,
        path,
        method,
      ),
    ).toBe(false);
  });

  test("starts_with / ends_with / regex", () => {
    const h = headers({ "user-agent": "curl/8.5.0" });
    expect(
      matchSilentBanCondition(
        { target: "user-agent", op: "starts_with", value: "curl/" },
        h,
        path,
        method,
      ),
    ).toBe(true);
    expect(
      matchSilentBanCondition(
        { target: "user-agent", op: "ends_with", value: "8.5.0" },
        h,
        path,
        method,
      ),
    ).toBe(true);
    expect(
      matchSilentBanCondition(
        { target: "user-agent", op: "regex", value: "^curl/\\d" },
        h,
        path,
        method,
      ),
    ).toBe(true);
  });

  test("exists / not_exists", () => {
    const h = headers({ "x-client": "yes" });
    expect(
      matchSilentBanCondition(
        { target: "x-client", op: "exists" },
        h,
        path,
        method,
      ),
    ).toBe(true);
    expect(
      matchSilentBanCondition(
        { target: "x-missing", op: "exists" },
        h,
        path,
        method,
      ),
    ).toBe(false);
    expect(
      matchSilentBanCondition(
        { target: "x-missing", op: "not_exists" },
        h,
        path,
        method,
      ),
    ).toBe(true);
  });

  test("missing header: not_contains / not_equals succeed", () => {
    const h = headers({});
    expect(
      matchSilentBanCondition(
        { target: "user-agent", op: "not_contains", value: "curl" },
        h,
        path,
        method,
      ),
    ).toBe(true);
    expect(
      matchSilentBanCondition(
        { target: "user-agent", op: "contains", value: "curl" },
        h,
        path,
        method,
      ),
    ).toBe(false);
  });

  test("path and method targets", () => {
    const h = headers({});
    expect(
      matchSilentBanCondition(
        { target: "path", op: "contains", value: "/agent/" },
        h,
        path,
        method,
      ),
    ).toBe(true);
    expect(
      matchSilentBanCondition(
        { target: "method", op: "equals", value: "post" },
        h,
        path,
        method,
      ),
    ).toBe(true);
  });
});

describe("matchSilentBanRule", () => {
  test("AND semantics across conditions; disabled / empty never match", () => {
    const h = headers({
      "user-agent": "curl/8.0",
      "x-client": "scraper",
    });
    const conditions: SilentBanCondition[] = [
      { target: "user-agent", op: "contains", value: "curl" },
      { target: "x-client", op: "equals", value: "scraper" },
    ];

    expect(
      matchSilentBanRule({ enabled: true, conditions }, h, "/v1/a", "POST"),
    ).toBe(true);

    expect(
      matchSilentBanRule(
        {
          enabled: true,
          conditions: [
            ...conditions,
            { target: "user-agent", op: "contains", value: "python" },
          ],
        },
        h,
        "/v1/a",
        "POST",
      ),
    ).toBe(false);

    expect(
      matchSilentBanRule({ enabled: false, conditions }, h, "/v1/a", "POST"),
    ).toBe(false);

    expect(
      matchSilentBanRule({ enabled: true, conditions: [] }, h, "/v1/a", "POST"),
    ).toBe(false);
  });
});

describe("validateSilentBanConditions", () => {
  test("rejects empty / invalid ops / missing value", () => {
    expect(validateSilentBanConditions([])).toEqual({
      ok: false,
      error: "conditions must include at least one condition",
    });
    expect(
      validateSilentBanConditions([{ target: "ua", op: "nope", value: "x" }]),
    ).toMatchObject({ ok: false });
    expect(
      validateSilentBanConditions([{ target: "user-agent", op: "contains" }]),
    ).toMatchObject({ ok: false });
    expect(
      validateSilentBanConditions([
        { target: "user-agent", op: "contains", value: "curl" },
      ]),
    ).toMatchObject({ ok: true });
    expect(
      validateSilentBanConditions([{ target: "x-foo", op: "exists" }]),
    ).toMatchObject({ ok: true });
  });

  test("rejects invalid regex", () => {
    expect(
      validateSilentBanConditions([
        { target: "user-agent", op: "regex", value: "(" },
      ]),
    ).toMatchObject({ ok: false });
  });
});
