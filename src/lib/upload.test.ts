import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadFiles: vi.fn(
    async (
      _file: Blob & { name: string; customId?: string },
      _options: unknown,
    ): Promise<{ data: { key: string; ufsUrl: string } | null; error: unknown }> => ({
      data: { key: "file-key", ufsUrl: "https://app.ufs.sh/f/file-key" },
      error: null,
    }),
  ),
  generateSignedURL: vi.fn(async (key: string, options: { expiresIn: number }) => ({
    ufsUrl: `https://app.ufs.sh/f/${key}?expires=${options.expiresIn}`,
  })),
  deleteFiles: vi.fn(async (keys: string[], _options?: { keyType?: string }) => ({
    success: true,
    deletedCount: keys.length,
  })),
}));

vi.mock("@/env", () => ({ env: { UPLOADTHING_TOKEN: "token" } }));
vi.mock("uploadthing/server", async (importOriginal) => ({
  UTFile: (await importOriginal<typeof import("uploadthing/server")>()).UTFile,
  UTApi: class {
    uploadFiles = mocks.uploadFiles;
    generateSignedURL = mocks.generateSignedURL;
    deleteFiles = mocks.deleteFiles;
  },
}));

const {
  ATTACHMENT_EXPORT_URL_TTL_SECONDS,
  ATTACHMENT_FETCH_URL_TTL_SECONDS,
  ATTACHMENT_VIEW_URL_TTL_SECONDS,
  deleteStoredFiles,
  isStorageConfigured,
  signAttachmentUrl,
  uploadPrivateFile,
} = await import("./upload");

beforeEach(() => {
  mocks.uploadFiles.mockClear();
  mocks.generateSignedURL.mockClear();
  mocks.deleteFiles.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

test("files are uploaded as private, tagged with their row id, and only their key is kept", async () => {
  expect(isStorageConfigured()).toBe(true);
  const file = new File(["xyz"], "a.png", { type: "image/png", lastModified: 1234 });
  expect(await uploadPrivateFile(file, "attachment-id")).toBe("file-key");
  expect(mocks.uploadFiles).toHaveBeenCalledOnce();
  const [uploaded, options] = mocks.uploadFiles.mock.calls[0]!;
  expect(options).toEqual({ acl: "private" });
  expect(uploaded).toMatchObject({
    name: "a.png",
    type: "image/png",
    size: 3,
    lastModified: 1234,
    customId: "attachment-id",
  });
  expect(await uploaded.text()).toBe("xyz");
});

test("a failed upload returns null", async () => {
  mocks.uploadFiles.mockResolvedValueOnce({ data: null, error: { code: "UPLOAD_FAILED" } });
  expect(await uploadPrivateFile(new File(["x"], "a.png"), "id")).toBeNull();
  mocks.uploadFiles.mockRejectedValueOnce(new Error("network"));
  expect(await uploadPrivateFile(new File(["x"], "a.png"), "id")).toBeNull();
});

test("signed URLs use the requested lifetime", async () => {
  expect([
    ATTACHMENT_VIEW_URL_TTL_SECONDS,
    ATTACHMENT_FETCH_URL_TTL_SECONDS,
    ATTACHMENT_EXPORT_URL_TTL_SECONDS,
  ]).toEqual([600, 300, 900]);
  expect(await signAttachmentUrl("file-key", ATTACHMENT_VIEW_URL_TTL_SECONDS)).toBe(
    "https://app.ufs.sh/f/file-key?expires=600",
  );
  expect(mocks.generateSignedURL).toHaveBeenCalledWith("file-key", { expiresIn: 600 });
});

test("stored files are deleted in batches, best effort, reporting the keys that are gone", async () => {
  const keys = Array.from({ length: 250 }, (_, index) => `key-${index}`);
  mocks.deleteFiles.mockRejectedValueOnce(new Error("temporarily unavailable"));
  mocks.deleteFiles.mockResolvedValueOnce({ success: false, deletedCount: 0 });
  // The first two batches failed: only the last one's keys are reported deleted.
  await expect(deleteStoredFiles([...keys, "key-0", ""])).resolves.toEqual(keys.slice(200));
  expect(mocks.deleteFiles.mock.calls.map(([batch]) => batch.length)).toEqual([100, 100, 50]);
  expect(mocks.deleteFiles.mock.calls.flatMap(([batch]) => batch)).toEqual(keys);
  expect(mocks.deleteFiles.mock.calls.every(([, options]) => options?.keyType === "fileKey")).toBe(
    true,
  );
});

test("files whose key was never recorded are deleted by their custom id", async () => {
  expect(await deleteStoredFiles(["attachment-id"], "customId")).toEqual(["attachment-id"]);
  expect(mocks.deleteFiles).toHaveBeenCalledExactlyOnceWith(["attachment-id"], {
    keyType: "customId",
  });
});
