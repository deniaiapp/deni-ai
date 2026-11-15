import { beforeEach, expect, test, vi } from "vitest";
import {
  dueHealthCheckModels,
  getModelHealth,
  quotaRetryDelayMs,
  recordModelHealth,
} from "./model-health";

vi.mock("@/env", () => ({ env: {} }));
vi.mock("@deniai/ai/openrouter", () => ({ createDeniOpenRouter: vi.fn() }));

beforeEach(() => {
  delete (globalThis as { modelHealthResults?: unknown }).modelHealthResults;
});

const result = (model: string, available = true) => ({
  model,
  provider: "deni",
  available,
  latencyMs: 10,
  error: available ? null : "boom",
});

test("keeps the latest result per probed model in probe order", () => {
  const first = new Date("2026-01-01T00:00:00Z");
  const second = new Date("2026-01-01T00:05:00Z");
  recordModelHealth(result("gemini-3.5-flash-lite"), first);
  recordModelHealth(result("gpt-6-luna"), first);
  recordModelHealth(result("gpt-6-luna", false), second);
  expect(getModelHealth()).toMatchObject([
    { ...result("gpt-6-luna", false), checkedAt: second },
    { ...result("gemini-3.5-flash-lite"), checkedAt: first },
  ]);
});

test("ignores models that are no longer probed", () => {
  recordModelHealth(result("retired-model"));
  expect(getModelHealth()).toEqual([]);
});

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const GOOGLE_DAILY_QUOTA_ERROR =
  "[Google AI Studio] You exceeded your current quota, please check your plan and billing details.\n" +
  "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash\n" +
  "Please retry in 22h4m22.550447606s.";

test("probes Gemini 3.5 Flash-Lite every 30 minutes and the other models every 5 minutes", () => {
  const checkedAt = new Date("2026-01-01T00:00:00Z");
  for (const model of ["gpt-6-luna", "gemini-3.5-flash-lite", "claude-haiku-5.5"]) {
    recordModelHealth(result(model), checkedAt);
  }
  const at = (ms: number) => checkedAt.getTime() + ms;
  expect(dueHealthCheckModels(at(4 * MINUTE))).toEqual([]);
  expect(dueHealthCheckModels(at(5 * MINUTE))).toEqual(["gpt-6-luna", "claude-haiku-5.5"]);
  expect(dueHealthCheckModels(at(30 * MINUTE))).toEqual([
    "gpt-6-luna",
    "gemini-3.5-flash-lite",
    "claude-haiku-5.5",
  ]);
  // A result stays shown until 15 minutes after its next probe was due.
  expect(getModelHealth()[1]?.staleAt).toEqual(new Date(at(45 * MINUTE)));
});

test("probes every model that has no result yet", () => {
  expect(dueHealthCheckModels()).toEqual([
    "gpt-6-luna",
    "gemini-3.5-flash-lite",
    "claude-haiku-5.5",
  ]);
});

test("waits for the retry time a quota refusal names before probing again", () => {
  const checkedAt = new Date("2026-01-01T00:00:00Z");
  recordModelHealth(
    { ...result("gpt-6-luna", false), retryAfterMs: quotaRetryDelayMs(GOOGLE_DAILY_QUOTA_ERROR)! },
    checkedAt,
  );
  const [record] = getModelHealth();
  expect(record).not.toHaveProperty("retryAfterMs");
  const retryAt = checkedAt.getTime() + (22 * 3600 + 4 * 60 + 22.551) * 1000;
  expect(record?.nextCheckAt.getTime()).toBe(retryAt);
  expect(dueHealthCheckModels(retryAt - 1)).not.toContain("gpt-6-luna");
  expect(dueHealthCheckModels(retryAt)).toContain("gpt-6-luna");
});

test("reads the retry time from quota errors only", () => {
  expect(quotaRetryDelayMs(GOOGLE_DAILY_QUOTA_ERROR)).toBe((22 * 3600 + 4 * 60 + 22.551) * 1000);
  expect(quotaRetryDelayMs("RESOURCE_EXHAUSTED: Quota exceeded. Please retry in 40s.")).toBe(
    40_000,
  );
  expect(quotaRetryDelayMs("You exceeded your current quota")).toBe(HOUR);
  expect(quotaRetryDelayMs("Quota exceeded. Please retry in 30h.")).toBe(24 * HOUR);
  expect(quotaRetryDelayMs("Bad request")).toBeNull();
  expect(quotaRetryDelayMs("Please retry in 5m")).toBeNull();
});
