import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { register } from "./instrumentation";

const mocks = vi.hoisted(() => ({
  startModelHealthScheduler: vi.fn(),
  startBackgroundJobScheduler: vi.fn(),
}));
vi.mock("@sentry/tanstackstart-react", () => ({ init: vi.fn() }));
vi.mock("@/lib/sentry-options", () => ({ getSentryOptions: () => ({}) }));
vi.mock("@/lib/abort-diagnostics", () => ({ installAbortDiagnostics: vi.fn() }));
vi.mock("@/lib/process-warnings", () => ({ installProcessWarningFilter: vi.fn() }));
vi.mock("@/lib/model-health-scheduler", () => ({
  startModelHealthScheduler: mocks.startModelHealthScheduler,
}));
vi.mock("@/lib/background-job-scheduler", () => ({
  startBackgroundJobScheduler: mocks.startBackgroundJobScheduler,
}));

beforeEach(() => {
  mocks.startModelHealthScheduler.mockReset();
  mocks.startBackgroundJobScheduler.mockReset();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

test("a production server starts the model health and background job schedulers", async () => {
  await register();
  expect(mocks.startModelHealthScheduler).toHaveBeenCalledOnce();
  expect(mocks.startBackgroundJobScheduler).toHaveBeenCalledOnce();
});

test("Vercel functions do not start the background jobs, which use the cron routes there", async () => {
  vi.stubEnv("VERCEL", "1");
  await register();
  expect(mocks.startModelHealthScheduler).toHaveBeenCalledOnce();
  expect(mocks.startBackgroundJobScheduler).not.toHaveBeenCalled();
});

test("development servers start no schedulers", async () => {
  vi.stubEnv("NODE_ENV", "development");
  await register();
  expect(mocks.startModelHealthScheduler).not.toHaveBeenCalled();
  expect(mocks.startBackgroundJobScheduler).not.toHaveBeenCalled();
});
