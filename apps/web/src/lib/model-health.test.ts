import { beforeEach, expect, test, vi } from "vitest";
import { getModelHealth, recordModelHealth } from "./model-health";

vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/lib/openrouter-provider", () => ({ createDeniOpenRouter: vi.fn() }));

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
  recordModelHealth(result("gpt-5.6-luna"), first);
  recordModelHealth(result("gpt-6-luna"), first);
  recordModelHealth(result("gpt-6-luna", false), second);
  expect(getModelHealth()).toEqual([
    { ...result("gpt-6-luna", false), checkedAt: second },
    { ...result("gpt-5.6-luna"), checkedAt: first },
  ]);
});

test("ignores models that are no longer probed", () => {
  recordModelHealth(result("retired-model"));
  expect(getModelHealth()).toEqual([]);
});
