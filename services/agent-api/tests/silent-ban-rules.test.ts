import assert from "node:assert/strict";
import { describe, test } from "node:test";
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
    assert.equal(resolveSilentBanTarget("path", h, "/v1/agent", "POST"), "/v1/agent");
    assert.equal(resolveSilentBanTarget("method", h, "/v1/agent", "post"), "POST");
    assert.equal(resolveSilentBanTarget("user-agent", h, "/", "GET"), "curl/8.0");
    assert.equal(resolveSilentBanTarget("header:x-client", h, "/", "GET"), "bot");
    assert.equal(resolveSilentBanTarget("missing", h, "/", "GET"), null);
  });
});

describe("matchSilentBanCondition", () => {
  const path = "/v1/agent/chat/completions";
  const method = "POST";

  test("contains / not_contains on user-agent", () => {
    const h = headers({ "user-agent": "python-requests/2.31.0" });
    assert.equal(
      matchSilentBanCondition(
        { target: "user-agent", op: "contains", value: "python-requests" },
        h,
        path,
        method,
      ),
      true,
    );
    assert.equal(
      matchSilentBanCondition(
        { target: "user-agent", op: "not_contains", value: "python-requests" },
        h,
        path,
        method,
      ),
      false,
    );
    assert.equal(
      matchSilentBanCondition(
        { target: "user-agent", op: "contains", value: "curl" },
        h,
        path,
        method,
      ),
      false,
    );
  });

  test("equals is case-insensitive by default", () => {
    const h = headers({ "x-app": "CLI" });
    assert.equal(
      matchSilentBanCondition(
        { target: "x-app", op: "equals", value: "cli" },
        h,
        path,
        method,
      ),
      true,
    );
    assert.equal(
      matchSilentBanCondition(
        { target: "x-app", op: "equals", value: "cli", caseSensitive: true },
        h,
        path,
        method,
      ),
      false,
    );
  });

  test("starts_with / ends_with / regex", () => {
    const h = headers({ "user-agent": "curl/8.5.0" });
    assert.equal(
      matchSilentBanCondition(
        { target: "user-agent", op: "starts_with", value: "curl/" },
        h,
        path,
        method,
      ),
      true,
    );
    assert.equal(
      matchSilentBanCondition(
        { target: "user-agent", op: "ends_with", value: "8.5.0" },
        h,
        path,
        method,
      ),
      true,
    );
    assert.equal(
      matchSilentBanCondition(
        { target: "user-agent", op: "regex", value: "^curl/\\d" },
        h,
        path,
        method,
      ),
      true,
    );
  });

  test("exists / not_exists", () => {
    const h = headers({ "x-client": "yes" });
    assert.equal(
      matchSilentBanCondition(
        { target: "x-client", op: "exists" },
        h,
        path,
        method,
      ),
      true,
    );
    assert.equal(
      matchSilentBanCondition(
        { target: "x-missing", op: "exists" },
        h,
        path,
        method,
      ),
      false,
    );
    assert.equal(
      matchSilentBanCondition(
        { target: "x-missing", op: "not_exists" },
        h,
        path,
        method,
      ),
      true,
    );
  });

  test("missing header: not_contains / not_equals succeed", () => {
    const h = headers({});
    assert.equal(
      matchSilentBanCondition(
        { target: "user-agent", op: "not_contains", value: "curl" },
        h,
        path,
        method,
      ),
      true,
    );
    assert.equal(
      matchSilentBanCondition(
        { target: "user-agent", op: "contains", value: "curl" },
        h,
        path,
        method,
      ),
      false,
    );
  });

  test("path and method targets", () => {
    const h = headers({});
    assert.equal(
      matchSilentBanCondition(
        { target: "path", op: "contains", value: "/agent/" },
        h,
        path,
        method,
      ),
      true,
    );
    assert.equal(
      matchSilentBanCondition(
        { target: "method", op: "equals", value: "post" },
        h,
        path,
        method,
      ),
      true,
    );
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

    assert.equal(matchSilentBanRule({ enabled: true, conditions }, h, "/v1/a", "POST"), true);

    assert.equal(
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
      false,
    );

    assert.equal(matchSilentBanRule({ enabled: false, conditions }, h, "/v1/a", "POST"), false);

    assert.equal(matchSilentBanRule({ enabled: true, conditions: [] }, h, "/v1/a", "POST"), false);
  });
});

describe("validateSilentBanConditions", () => {
  test("rejects empty / invalid ops / missing value", () => {
    assert.deepEqual(validateSilentBanConditions([]), {
      ok: false,
      error: "conditions must include at least one condition",
    });
    assert.partialDeepStrictEqual(
      validateSilentBanConditions([{ target: "ua", op: "nope", value: "x" }]),
      { ok: false },
    );
    assert.partialDeepStrictEqual(
      validateSilentBanConditions([{ target: "user-agent", op: "contains" }]),
      { ok: false },
    );
    assert.partialDeepStrictEqual(
      validateSilentBanConditions([
        { target: "user-agent", op: "contains", value: "curl" },
      ]),
      { ok: true },
    );
    assert.partialDeepStrictEqual(
      validateSilentBanConditions([{ target: "x-foo", op: "exists" }]),
      { ok: true },
    );
  });

  test("rejects invalid regex", () => {
    assert.partialDeepStrictEqual(
      validateSilentBanConditions([
        { target: "user-agent", op: "regex", value: "(" },
      ]),
      { ok: false },
    );
  });
});
