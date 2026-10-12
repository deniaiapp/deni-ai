import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  FAILURE_REPORT_INTERVAL_MS,
  scheduleBackgroundJob,
  startBackgroundJobScheduler,
  stuckRunThresholdMs,
  type BackgroundJob,
} from "./background-job-scheduler";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  usageAndMeter: vi.fn(),
  storageCleanup: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
  captureMessage: mocks.captureMessage,
}));
vi.mock("@/lib/usage-and-meter-job", () => ({ runUsageAndMeterJob: mocks.usageAndMeter }));
vi.mock("@/lib/storage-cleanup-job", () => ({ runStorageCleanupJob: mocks.storageCleanup }));

const healthyUsage = {
  delivered: 1,
  failed: 0,
  requiresReview: 0,
  recovered: 0,
  recoveryFailed: 0,
  healthy: true,
};
const healthyStorage = {
  storageConfigured: true,
  marked: 0,
  deleted: 0,
  failed: 0,
  exports: { deleted: 0, failed: 0 },
  healthy: true,
};
const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  delete (globalThis as { scheduledBackgroundJobs?: Set<string> }).scheduledBackgroundJobs;
  mocks.captureException.mockReset();
  mocks.captureMessage.mockReset();
  mocks.usageAndMeter.mockReset().mockResolvedValue(healthyUsage);
  mocks.storageCleanup.mockReset().mockResolvedValue(healthyStorage);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function job(run: BackgroundJob["run"]): BackgroundJob {
  return { name: "test-job", firstDelayMs: 1_000, intervalMs: MINUTE, run };
}

test("usage and meter runs 30 seconds after boot, then every minute", async () => {
  startBackgroundJobScheduler();
  await vi.advanceTimersByTimeAsync(29_999);
  expect(mocks.usageAndMeter).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.usageAndMeter).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(mocks.usageAndMeter).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(3 * MINUTE);
  expect(mocks.usageAndMeter).toHaveBeenCalledTimes(5);
  expect(mocks.captureMessage).not.toHaveBeenCalled();
});

test("storage cleanup runs 2 minutes after boot, then every hour", async () => {
  startBackgroundJobScheduler();
  await vi.advanceTimersByTimeAsync(2 * MINUTE - 1);
  expect(mocks.storageCleanup).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.storageCleanup).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60 * MINUTE - 1);
  expect(mocks.storageCleanup).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.storageCleanup).toHaveBeenCalledTimes(2);
});

test("starting again (HMR, a second register) does not schedule the jobs twice", async () => {
  startBackgroundJobScheduler();
  startBackgroundJobScheduler();
  await vi.advanceTimersByTimeAsync(2 * MINUTE);
  expect(mocks.usageAndMeter).toHaveBeenCalledTimes(2);
  expect(mocks.storageCleanup).toHaveBeenCalledTimes(1);
});

test("the timers do not keep the process alive", async () => {
  const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
  const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
  scheduleBackgroundJob(job(async () => null));
  await vi.advanceTimersByTimeAsync(1_000);
  const timers = [...setTimeoutSpy.mock.results, ...setIntervalSpy.mock.results].map(
    (result) => result.value as NodeJS.Timeout,
  );
  expect(timers).toHaveLength(2);
  for (const timer of timers) expect(timer.hasRef()).toBe(false);
});

test("a run still in progress makes the next ticks skip instead of overlapping", async () => {
  let finish = () => {};
  const run = vi.fn(
    () =>
      new Promise<null>((resolve) => {
        finish = () => resolve(null);
      }),
  );
  scheduleBackgroundJob(job(run));
  await vi.advanceTimersByTimeAsync(1_000 + 3 * MINUTE);
  expect(run).toHaveBeenCalledTimes(1);
  expect(mocks.captureMessage).not.toHaveBeenCalled();
  finish();
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(run).toHaveBeenCalledTimes(2);
});

test("a run is stuck after three intervals, and at least 15 minutes", () => {
  expect(stuckRunThresholdMs(MINUTE)).toBe(15 * MINUTE);
  expect(stuckRunThresholdMs(60 * MINUTE)).toBe(3 * 60 * MINUTE);
});

test("a run that never finishes is reported as stuck, at most once an hour", async () => {
  let finish = () => {};
  const run = vi.fn(
    () =>
      new Promise<null>((resolve) => {
        finish = () => resolve(null);
      }),
  );
  scheduleBackgroundJob(job(run));
  await vi.advanceTimersByTimeAsync(1_000 + 14 * MINUTE);
  expect(mocks.captureMessage).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(mocks.captureMessage).toHaveBeenCalledExactlyOnceWith("Background job test-job is stuck", {
    level: "warning",
    tags: { job: "test-job" },
    extra: { runningForMs: 15 * MINUTE },
  });
  expect(console.error).toHaveBeenCalledWith("[background-jobs] test-job is stuck", {
    runningForMs: 15 * MINUTE,
  });

  // Still stuck: quiet for an hour, then reported again.
  await vi.advanceTimersByTimeAsync(FAILURE_REPORT_INTERVAL_MS - MINUTE);
  expect(mocks.captureMessage).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(mocks.captureMessage).toHaveBeenCalledTimes(2);
  expect(mocks.captureMessage).toHaveBeenLastCalledWith(
    "Background job test-job is stuck",
    expect.objectContaining({ extra: { runningForMs: 75 * MINUTE } }),
  );
  expect(run).toHaveBeenCalledTimes(1);

  // Once it finishes, the job runs again.
  finish();
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(run).toHaveBeenCalledTimes(2);
  expect(mocks.captureMessage).toHaveBeenCalledTimes(2);
});

test("a storage cleanup still running after 3 hours is reported as stuck", async () => {
  mocks.storageCleanup.mockReturnValue(new Promise(() => {}));
  startBackgroundJobScheduler();
  await vi.advanceTimersByTimeAsync(2 * MINUTE + 2 * 60 * MINUTE);
  expect(mocks.captureMessage).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60 * MINUTE);
  expect(mocks.captureMessage).toHaveBeenCalledExactlyOnceWith(
    "Background job storage-cleanup is stuck",
    {
      level: "warning",
      tags: { job: "storage-cleanup" },
      extra: { runningForMs: 3 * 60 * MINUTE },
    },
  );
  expect(mocks.storageCleanup).toHaveBeenCalledOnce();
});

test("errors are caught and sent to Sentry, and the job keeps running", async () => {
  const error = new Error("database unavailable");
  mocks.usageAndMeter.mockRejectedValueOnce(error);
  startBackgroundJobScheduler();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.captureException).toHaveBeenCalledWith(error, {
    tags: { job: "usage-and-meter" },
  });
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(mocks.usageAndMeter).toHaveBeenCalledTimes(2);
  expect(mocks.captureException).toHaveBeenCalledTimes(1);
});

test("failing usage runs send a Sentry warning with their failure counts", async () => {
  mocks.usageAndMeter.mockResolvedValue({
    ...healthyUsage,
    failed: 2,
    recoveryFailed: 1,
    requiresReview: 3,
    healthy: false,
  });
  startBackgroundJobScheduler();
  await vi.advanceTimersByTimeAsync(30_000);
  const counts = { recoveryFailed: 1, deliveryFailed: 2, requiresReview: 3 };
  expect(mocks.captureMessage).toHaveBeenCalledExactlyOnceWith(
    "Background job usage-and-meter reported failures",
    { level: "warning", tags: { job: "usage-and-meter" }, extra: counts },
  );
  expect(console.error).toHaveBeenCalledWith(
    "[background-jobs] usage-and-meter reported failures",
    counts,
  );
});

test("failing storage cleanups report the files that failed to delete", async () => {
  mocks.storageCleanup.mockResolvedValue({
    ...healthyStorage,
    failed: 4,
    exports: { deleted: 0, failed: 2 },
    healthy: false,
  });
  startBackgroundJobScheduler();
  await vi.advanceTimersByTimeAsync(2 * MINUTE);
  expect(mocks.captureMessage).toHaveBeenCalledExactlyOnceWith(
    "Background job storage-cleanup reported failures",
    {
      level: "warning",
      tags: { job: "storage-cleanup" },
      extra: { attachmentsFailed: 4, exportsFailed: 2 },
    },
  );
});

test("a deployment without storage reports nothing", async () => {
  mocks.storageCleanup.mockResolvedValue({ storageConfigured: false, healthy: true });
  startBackgroundJobScheduler();
  await vi.advanceTimersByTimeAsync(2 * MINUTE);
  expect(mocks.storageCleanup).toHaveBeenCalledOnce();
  expect(mocks.captureMessage).not.toHaveBeenCalled();
});

test("a persistent failure is reported once an hour unless a count grows", async () => {
  let counts: Record<string, number> | null = { failed: 1, review: 2 };
  scheduleBackgroundJob(job(async () => counts));
  await vi.advanceTimersByTimeAsync(1_000);
  expect(mocks.captureMessage).toHaveBeenCalledTimes(1);

  // The same or lower counts, and healthy runs in between, stay quiet within the hour.
  await vi.advanceTimersByTimeAsync(10 * MINUTE);
  counts = null;
  await vi.advanceTimersByTimeAsync(5 * MINUTE);
  counts = { failed: 0, review: 2 };
  await vi.advanceTimersByTimeAsync(5 * MINUTE);
  expect(mocks.captureMessage).toHaveBeenCalledTimes(1);
  expect(console.error).toHaveBeenCalledTimes(1);

  // A count past the reported one is reported at once.
  counts = { failed: 0, review: 3 };
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(mocks.captureMessage).toHaveBeenCalledTimes(2);
  expect(mocks.captureMessage).toHaveBeenLastCalledWith(
    "Background job test-job reported failures",
    expect.objectContaining({ extra: { failed: 0, review: 3 } }),
  );
  await vi.advanceTimersByTimeAsync(FAILURE_REPORT_INTERVAL_MS - MINUTE);
  expect(mocks.captureMessage).toHaveBeenCalledTimes(2);

  // An hour after the last report, the still failing job is reported again.
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(mocks.captureMessage).toHaveBeenCalledTimes(3);
});
