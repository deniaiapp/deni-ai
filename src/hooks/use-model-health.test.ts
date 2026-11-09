import { expect, test } from "vitest";
import { getModelHealthStatus, summarizeModelHealth } from "@/hooks/use-model-health";

const now = Date.parse("2026-01-01T00:10:00.000Z");
const checkedAt = "2026-01-01T00:05:00.000Z";

test("a later probe on the same route does not hide an earlier failure", () => {
  const health = summarizeModelHealth(
    [
      { model: "gpt-6-luna", provider: "deni", available: false, checkedAt },
      { model: "gpt-5.6-luna", provider: "deni", available: true, checkedAt },
    ],
    now,
  );

  expect(health.byProvider.deni).toBe("unavailable");
  // Probed models show their own result; unprobed models show their generation's result.
  expect(getModelHealthStatus(health, "gpt-6-luna", "deni")).toBe("unavailable");
  expect(getModelHealthStatus(health, "gpt-5.6-luna", "deni")).toBe("available");
  expect(getModelHealthStatus(health, "gpt-6-sol", "deni")).toBe("unavailable");
});

test("one failing probe does not mark another probed model on its route as down", () => {
  const health = summarizeModelHealth(
    [
      { model: "gpt-6-luna", provider: "deni", available: true, checkedAt },
      { model: "gpt-5.6-luna", provider: "deni", available: false, checkedAt },
    ],
    now,
  );

  expect(getModelHealthStatus(health, "gpt-6-luna", "deni")).toBe("available");
  expect(getModelHealthStatus(health, "gpt-5.6-luna", "deni")).toBe("unavailable");
});

test("a failing probe marks only its own generation on the route", () => {
  const health = summarizeModelHealth(
    [
      { model: "gpt-6-luna", provider: "deni", available: true, checkedAt },
      { model: "gpt-5.6-luna", provider: "deni", available: false, checkedAt },
      { model: "claude-haiku-5.5", provider: "anthropic", available: false, checkedAt },
    ],
    now,
  );

  expect(getModelHealthStatus(health, "gpt-6-sol", "deni")).toBe("available");
  expect(getModelHealthStatus(health, "gpt-6.1-sol", "deni")).toBe("available");
  expect(getModelHealthStatus(health, "gpt-6-astra", "deni")).toBe("available");
  expect(getModelHealthStatus(health, "gpt-5.6-sol", "deni")).toBe("unavailable");
  // No probe covers Claude Opus, so it falls back to the route's combined result.
  expect(getModelHealthStatus(health, "claude-opus-5.5", "anthropic")).toBe("unavailable");
});

test("stale probes are ignored", () => {
  const health = summarizeModelHealth(
    [
      {
        model: "gpt-6-luna",
        provider: "deni",
        available: false,
        checkedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    Date.parse("2026-01-01T01:00:00.000Z"),
  );

  expect(getModelHealthStatus(health, "gpt-6-luna", "deni")).toBeUndefined();
});
