import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { register } from "./instrumentation";

const mocks = vi.hoisted(() => ({
  startModelHealthScheduler: vi.fn(),
  startBackgroundJobScheduler: vi.fn(),
  startInProcessRun: vi.fn(),
}));
vi.mock("@/lib/sentry-options", () => ({
  getSentryOptions: () => ({}),
  loadSentry: async () => null,
  sentryIntegrations: () => [],
}));
vi.mock("@/lib/abort-diagnostics", () => ({ installAbortDiagnostics: vi.fn() }));
vi.mock("@/lib/process-warnings", () => ({ installProcessWarningFilter: vi.fn() }));
vi.mock("@/lib/model-health-scheduler", () => ({
  startModelHealthScheduler: mocks.startModelHealthScheduler,
}));
vi.mock("@/lib/background-job-scheduler", () => ({
  startBackgroundJobScheduler: mocks.startBackgroundJobScheduler,
}));
vi.mock("@/lib/run/in-process.server", () => ({
  startInProcessRun: mocks.startInProcessRun,
}));

beforeEach(() => {
  mocks.startModelHealthScheduler.mockReset();
  mocks.startBackgroundJobScheduler.mockReset();
  mocks.startInProcessRun.mockReset();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("DISABLE_BACKGROUND_JOBS", undefined);
  vi.stubEnv("CRON_ENABLED", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

test("a production server starts the model health and background job schedulers", async () => {
  await register();
  expect(mocks.startModelHealthScheduler).toHaveBeenCalledOnce();
  expect(mocks.startBackgroundJobScheduler).toHaveBeenCalledOnce();
  // It decides from RUN_SCHEDULER_IN_PROCESS itself whether anything runs.
  expect(mocks.startInProcessRun).toHaveBeenCalledOnce();
});

test("a failing in-process Run start does not stop the server from starting", async () => {
  mocks.startInProcessRun.mockRejectedValueOnce(new Error("boom"));
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await expect(register()).resolves.toBeUndefined();
  expect(error).toHaveBeenCalledWith("[run] in-process worker failed to start", expect.any(Error));
  error.mockRestore();
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

test.each(["1", "true", "TRUE"])(
  "DISABLE_BACKGROUND_JOBS=%s keeps a production server (e.g. canary) from starting any scheduler",
  async (value) => {
    vi.stubEnv("DISABLE_BACKGROUND_JOBS", value);
    await register();
    expect(mocks.startModelHealthScheduler).not.toHaveBeenCalled();
    expect(mocks.startBackgroundJobScheduler).not.toHaveBeenCalled();
    expect(mocks.startInProcessRun).not.toHaveBeenCalled();
  },
);

test.each(["false", "0", "off"])(
  "CRON_ENABLED=%s keeps the shared-database jobs off but still checks model health",
  async (value) => {
    vi.stubEnv("CRON_ENABLED", value);
    await register();
    expect(mocks.startModelHealthScheduler).toHaveBeenCalledOnce();
    expect(mocks.startBackgroundJobScheduler).not.toHaveBeenCalled();
  },
);

test("CRON_ENABLED=true starts the background jobs as before", async () => {
  vi.stubEnv("CRON_ENABLED", "true");
  await register();
  expect(mocks.startBackgroundJobScheduler).toHaveBeenCalledOnce();
});
