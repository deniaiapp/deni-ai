import * as Sentry from "@sentry/tanstackstart-react";
import { afterEach, expect, test, vi } from "vitest";
import { reportModelHealthChanges } from "./model-health-scheduler";

vi.mock("@sentry/tanstackstart-react", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("@/lib/model-health", () => ({ checkModelHealth: vi.fn() }));

const result = (error: string | null) => ({
  model: "gemini-3.8-flash",
  provider: "google",
  available: error === null,
  latencyMs: 10,
  error,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(Sentry.captureMessage).mockClear();
});

test("logs a probe failure once until its error changes or the model recovers", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const info = vi.spyOn(console, "info").mockImplementation(() => {});

  reportModelHealthChanges([result("Bad request")]);
  reportModelHealthChanges([result("Bad request")]);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.lastCall?.[0]).toContain("gemini-3.8-flash (google) failed: Bad request");
  expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);

  reportModelHealthChanges([result("Timeout")]);
  expect(warn).toHaveBeenCalledTimes(2);

  reportModelHealthChanges([result(null)]);
  reportModelHealthChanges([result(null)]);
  expect(info).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(2);
});
