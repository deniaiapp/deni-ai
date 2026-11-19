import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  hasObjectStorage: true,
  primeStorageKey: vi.fn(async () => undefined),
  forgetStorageKey: vi.fn(),
  deleteAllUserStorage: vi.fn(async () => undefined),
}));

vi.mock("@/lib/run/runtime.server", () => ({
  ensureRunConfigured: () =>
    mocks.configured
      ? { ok: true }
      : { ok: false, reason: "config_error", message: "not configured" },
}));

vi.mock("@deniai/run/data/paths", () => ({
  primeStorageKey: mocks.primeStorageKey,
  forgetStorageKey: mocks.forgetStorageKey,
}));

vi.mock("@deniai/run/data/storage", () => ({
  hasObjectStorage: () => mocks.hasObjectStorage,
  deleteAllUserStorage: mocks.deleteAllUserStorage,
}));

const { accountDeletionRunHooks } = await import("./account-deletion.server");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured = true;
  mocks.hasObjectStorage = true;
  mocks.primeStorageKey.mockResolvedValue(undefined);
  mocks.deleteAllUserStorage.mockResolvedValue(undefined);
});

describe("accountDeletionRunHooks", () => {
  test("primes the user's storageKey before deletion and deletes objects then forgets cache after", async () => {
    await accountDeletionRunHooks.before({ id: "user-1" });
    await accountDeletionRunHooks.after({ id: "user-1" });

    expect(mocks.primeStorageKey).toHaveBeenCalledWith("user-1");
    expect(mocks.deleteAllUserStorage).toHaveBeenCalledWith("user-1");
    expect(mocks.forgetStorageKey).toHaveBeenCalledWith("user-1");

    const primeOrder = mocks.primeStorageKey.mock.invocationCallOrder[0]!;
    const deleteOrder = mocks.deleteAllUserStorage.mock.invocationCallOrder[0]!;
    const forgetOrder = mocks.forgetStorageKey.mock.invocationCallOrder[0]!;
    expect(primeOrder).toBeLessThan(deleteOrder);
    expect(deleteOrder).toBeLessThan(forgetOrder);
  });

  test("skips storage operations when Run object storage is unconfigured", async () => {
    mocks.hasObjectStorage = false;

    await accountDeletionRunHooks.before({ id: "user-2" });
    await accountDeletionRunHooks.after({ id: "user-2" });

    expect(mocks.primeStorageKey).not.toHaveBeenCalled();
    expect(mocks.deleteAllUserStorage).not.toHaveBeenCalled();
    expect(mocks.forgetStorageKey).toHaveBeenCalledWith("user-2");
  });

  test("never throws when priming or deleting storage fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.deleteAllUserStorage.mockRejectedValueOnce(new Error("S3 down"));

    await expect(accountDeletionRunHooks.before({ id: "user-3" })).resolves.toBeUndefined();
    await expect(accountDeletionRunHooks.after({ id: "user-3" })).resolves.toBeUndefined();

    expect(mocks.forgetStorageKey).toHaveBeenCalledWith("user-3");
    errorSpy.mockRestore();
  });
});
