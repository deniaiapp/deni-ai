import { afterEach, beforeEach, expect, test, vi } from "vitest";

const jobs = vi.hoisted(() => ({
  guests: vi.fn(),
  health: vi.fn(),
  storage: vi.fn(),
  usage: vi.fn(),
}));
vi.mock("@/env", () => ({ env: { CRON_SECRET: "s".repeat(32) } }));
vi.mock("@/lib/guest-cleanup-job", () => ({ runGuestCleanupJob: jobs.guests }));
vi.mock("@/lib/model-health", () => ({ checkModelHealth: jobs.health }));
vi.mock("@/lib/storage-cleanup-job", () => ({ runStorageCleanupJob: jobs.storage }));
vi.mock("@/lib/usage-and-meter-job", () => ({
  runUsageAndMeterJob: jobs.usage,
  getUsageAndMeterNextDueAt: vi.fn(async () => null),
}));

const routes = {
  "guest-cleanup": await import("./guest-cleanup/route"),
  "model-health": await import("./model-health/route"),
  "storage-cleanup": await import("./storage-cleanup/route"),
  "usage-and-meter": await import("./usage-and-meter/route"),
};

beforeEach(() => {
  for (const job of Object.values(jobs)) job.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const authorized = (name: string) =>
  new Request(`http://localhost/api/cron/${name}`, {
    headers: { authorization: `Bearer ${"s".repeat(32)}` },
  });

test.each(Object.entries(routes))(
  "CRON_ENABLED=false makes /api/cron/%s a no-op, even for the scheduler",
  async (name, { GET }) => {
    vi.stubEnv("CRON_ENABLED", "false");
    const response = await GET(authorized(name));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ skipped: true, reason: "cron_disabled" });
    for (const job of Object.values(jobs)) expect(job).not.toHaveBeenCalled();
  },
);

test("the cron routes still run their job by default", async () => {
  jobs.guests.mockResolvedValue({ deleted: 0, failed: 0, healthy: true });
  const response = await routes["guest-cleanup"].GET(authorized("guest-cleanup"));
  expect(response.status).toBe(200);
  expect(jobs.guests).toHaveBeenCalledOnce();
});
