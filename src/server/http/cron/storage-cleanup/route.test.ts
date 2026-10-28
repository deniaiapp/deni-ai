import { beforeEach, expect, test, vi } from "vitest";
import { GET } from "./route";

const state = vi.hoisted(() => ({
  env: { CRON_SECRET: "s".repeat(32) as string | undefined },
  configured: true,
  cleanUp: vi.fn(),
  cleanUpExports: vi.fn(),
}));
vi.mock("@/env", () => ({ env: state.env }));
vi.mock("@/lib/upload", () => ({ isStorageConfigured: () => state.configured }));
vi.mock("@/lib/attachments", () => ({ cleanUpAttachmentStorage: state.cleanUp }));
vi.mock("@/lib/account-export-jobs", () => ({ cleanUpAccountExports: state.cleanUpExports }));

beforeEach(() => {
  state.env.CRON_SECRET = "s".repeat(32);
  state.configured = true;
  state.cleanUp.mockReset().mockResolvedValue({ marked: 2, deleted: 3, failed: 0 });
  state.cleanUpExports.mockReset().mockResolvedValue({ deleted: 1, failed: 0 });
});
const request = (authorization?: string) =>
  new Request("http://localhost/api/cron/storage-cleanup", {
    headers: authorization ? { authorization } : {},
  });

test.each([undefined, "Bearer invalid", `Bearer ${"x".repeat(32)}`])(
  "unauthorized callers cannot delete files: %s",
  async (authorization) => {
    expect((await GET(request(authorization))).status).toBe(401);
    expect(state.cleanUp).not.toHaveBeenCalled();
    expect(state.cleanUpExports).not.toHaveBeenCalled();
  },
);

test("cleanup is disabled without a configured secret", async () => {
  state.env.CRON_SECRET = undefined;
  expect((await GET(request())).status).toBe(503);
  expect(state.cleanUp).not.toHaveBeenCalled();
});

test("a run reports what it marked and deleted, including expired data exports", async () => {
  const response = await GET(request(`Bearer ${state.env.CRON_SECRET}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    marked: 2,
    deleted: 3,
    failed: 0,
    exports: { deleted: 1, failed: 0 },
  });
  expect(state.cleanUp).toHaveBeenCalledOnce();
  expect(state.cleanUpExports).toHaveBeenCalledOnce();
});

test("files that failed to delete make the run fail, so the scheduler alerts", async () => {
  state.cleanUp.mockResolvedValue({ marked: 0, deleted: 1, failed: 4 });
  const response = await GET(request(`Bearer ${state.env.CRON_SECRET}`));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    marked: 0,
    deleted: 1,
    failed: 4,
    exports: { deleted: 1, failed: 0 },
  });
});

test("export files that failed to delete make the run fail too", async () => {
  state.cleanUpExports.mockResolvedValue({ deleted: 0, failed: 2 });
  const response = await GET(request(`Bearer ${state.env.CRON_SECRET}`));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ failed: 0, exports: { deleted: 0, failed: 2 } });
});

test("without storage there is nothing to clean up", async () => {
  state.configured = false;
  const response = await GET(request(`Bearer ${state.env.CRON_SECRET}`));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ storageConfigured: false });
  expect(state.cleanUp).not.toHaveBeenCalled();
  expect(state.cleanUpExports).not.toHaveBeenCalled();
});
