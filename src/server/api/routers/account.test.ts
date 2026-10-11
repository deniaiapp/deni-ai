import { beforeEach, expect, test, vi } from "vitest";
import type { Context } from "../trpc";

const mocks = vi.hoisted(() => ({
  storageConfigured: false,
  buildAccountExport: vi.fn(async (_userId: string) => ({ chats: [] })),
  recordSecurityActivity: vi.fn(async (_activity: Record<string, unknown>) => {}),
  after: vi.fn((_task: () => Promise<void>) => {}),
  startAccountExport: vi.fn(),
  runAccountExportJob: vi.fn(async (_job: unknown) => {}),
  getLatestAccountExport: vi.fn(),
  findDownloadableAccountExportKey: vi.fn(
    async (_id: string, _userId: string, ..._rest: unknown[]): Promise<string | null> => null,
  ),
  signAttachmentUrl: vi.fn(
    async (key: string, seconds: number) => `https://app.ufs.sh/f/${key}?expires=${seconds}`,
  ),
}));
vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/account-export", () => ({ buildAccountExport: mocks.buildAccountExport }));
vi.mock("@/lib/account-export-jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-export-jobs")>()),
  startAccountExport: mocks.startAccountExport,
  runAccountExportJob: mocks.runAccountExportJob,
  getLatestAccountExport: mocks.getLatestAccountExport,
  findDownloadableAccountExportKey: mocks.findDownloadableAccountExportKey,
}));
vi.mock("@/lib/upload", () => ({
  ATTACHMENT_EXPORT_URL_TTL_SECONDS: 900,
  isStorageConfigured: () => mocks.storageConfigured,
  signAttachmentUrl: mocks.signAttachmentUrl,
}));
vi.mock("@/lib/security-activity", () => ({
  recordSecurityActivity: mocks.recordSecurityActivity,
}));

const { accountRouter } = await import("./account");

/** The security activity log, read for the last `data_exported` entry. */
const activityLog = (rows: Array<{ createdAt: Date }> = []) => ({
  select: () => ({
    from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => rows }) }) }),
  }),
});

// The export limiter is per user and per instance, so each test uses its own user.
let users = 0;
const caller = (db: object = activityLog()) => {
  const userId = `exporter-${++users}`;
  return {
    userId,
    db,
    account: accountRouter.createCaller({
      db: db as unknown as Context["db"],
      session: {
        session: { userId, ipAddress: "203.0.113.1", userAgent: "test" },
      } as Context["session"],
    }),
  };
};

const pendingExport = (id = "export-id") => ({
  id,
  status: "pending" as const,
  createdAt: new Date("2026-10-11T12:00:00Z"),
  completedAt: null,
  expiresAt: null,
  sizeBytes: null,
});

beforeEach(() => {
  mocks.storageConfigured = false;
  for (const mock of [
    mocks.buildAccountExport,
    mocks.recordSecurityActivity,
    mocks.after,
    mocks.startAccountExport,
    mocks.runAccountExportJob,
    mocks.getLatestAccountExport,
    mocks.findDownloadableAccountExportKey,
    mocks.signAttachmentUrl,
  ]) {
    mock.mockClear();
  }
  mocks.startAccountExport.mockReset();
  mocks.startAccountExport.mockImplementation(async () => ({
    export: pendingExport(),
    created: true,
  }));
  mocks.findDownloadableAccountExportKey.mockResolvedValue(null);
});

test.each([
  ["without storage", false],
  ["with background exports", true],
])(
  "concurrent requests, such as one batched request, start only one export (%s)",
  async (_mode, storageConfigured) => {
    mocks.storageConfigured = storageConfigured;
    const { account } = caller();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => account.requestExport()),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((result) => result.status === "rejected")) {
      expect(result.reason).toMatchObject({ code: "TOO_MANY_REQUESTS" });
    }
    const started = storageConfigured ? mocks.startAccountExport : mocks.buildAccountExport;
    expect(started).toHaveBeenCalledOnce();
    expect(mocks.recordSecurityActivity).toHaveBeenCalledOnce();
  },
);

test("an export in the last minute on another instance still throttles the request", async () => {
  mocks.storageConfigured = true;
  const { account } = caller(activityLog([{ createdAt: new Date(Date.now() - 10_000) }]));
  await expect(account.requestExport()).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
    message: "Please wait a minute before exporting again.",
  });
  expect(mocks.startAccountExport).not.toHaveBeenCalled();
});

test("without storage, the export is built in the request and returned to save", async () => {
  const { account, userId } = caller();
  const result = await account.requestExport();
  expect(result).toEqual({
    mode: "download",
    fileName: expect.stringMatching(/^deni-ai-export-\d{4}-\d{2}-\d{2}\.json$/),
    payload: { chats: [] },
  });
  expect(mocks.buildAccountExport).toHaveBeenCalledExactlyOnceWith(userId);
  expect(mocks.startAccountExport).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
  expect(mocks.recordSecurityActivity).toHaveBeenCalledExactlyOnceWith({
    userId,
    action: "data_exported",
    ipAddress: "203.0.113.1",
    userAgent: "test",
  });
});

test("with storage, the export is built after the response and the request is logged", async () => {
  mocks.storageConfigured = true;
  const { account, userId, db } = caller();
  const result = await account.requestExport();

  expect(result).toEqual({ mode: "background", export: pendingExport() });
  expect(mocks.startAccountExport).toHaveBeenCalledExactlyOnceWith(userId, {}, db);
  expect(mocks.buildAccountExport).not.toHaveBeenCalled();
  expect(mocks.recordSecurityActivity).toHaveBeenCalledOnce();
  expect(mocks.after).toHaveBeenCalledOnce();
  expect(mocks.runAccountExportJob).not.toHaveBeenCalled();

  await mocks.after.mock.calls[0]![0]();
  expect(mocks.runAccountExportJob).toHaveBeenCalledExactlyOnceWith({
    id: "export-id",
    userId,
    createdAt: pendingExport().createdAt,
  });
});

test("a request while an export is being built returns it without starting another", async () => {
  mocks.storageConfigured = true;
  mocks.startAccountExport.mockResolvedValue({ export: pendingExport("running"), created: false });
  const { account } = caller();

  expect(await account.requestExport()).toEqual({
    mode: "background",
    export: pendingExport("running"),
  });
  expect(mocks.after).not.toHaveBeenCalled();
  expect(mocks.recordSecurityActivity).not.toHaveBeenCalled();
});

test("the status is the signed-in user's latest export", async () => {
  mocks.storageConfigured = true;
  mocks.getLatestAccountExport.mockResolvedValue(pendingExport());
  const { account, userId, db } = caller();
  expect(await account.exportStatus()).toEqual(pendingExport());
  expect(mocks.getLatestAccountExport).toHaveBeenCalledExactlyOnceWith(userId, {}, db);
});

test("without storage, exports left from when it was configured are not shown", async () => {
  // A pending one would block the in-request export; a ready one cannot be downloaded.
  mocks.getLatestAccountExport.mockResolvedValue(pendingExport());
  const { account } = caller();
  expect(await account.exportStatus()).toBeNull();
  expect(mocks.getLatestAccountExport).not.toHaveBeenCalled();
});

test("a download URL is signed only for an export the signed-in user can download", async () => {
  mocks.storageConfigured = true;
  const { account, userId, db } = caller();

  // Someone else's, expired, unfinished or missing: all read the same.
  await expect(account.exportDownloadUrl({ id: "theirs" })).rejects.toMatchObject({
    code: "NOT_FOUND",
    message: "This export is no longer available.",
  });
  expect(mocks.findDownloadableAccountExportKey).toHaveBeenCalledExactlyOnceWith(
    "theirs",
    userId,
    {},
    db,
  );
  expect(mocks.signAttachmentUrl).not.toHaveBeenCalled();

  mocks.findDownloadableAccountExportKey.mockResolvedValue("key-mine");
  expect(await account.exportDownloadUrl({ id: "mine" })).toEqual({
    url: "https://app.ufs.sh/f/key-mine?expires=900",
  });
  expect(mocks.signAttachmentUrl).toHaveBeenCalledExactlyOnceWith("key-mine", 900);
});

test("without storage there is no export file to download", async () => {
  mocks.findDownloadableAccountExportKey.mockResolvedValue("key-mine");
  const { account } = caller();
  await expect(account.exportDownloadUrl({ id: "mine" })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(mocks.findDownloadableAccountExportKey).not.toHaveBeenCalled();
  expect(mocks.signAttachmentUrl).not.toHaveBeenCalled();
});
