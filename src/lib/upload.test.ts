import { afterEach, beforeEach, expect, test, vi } from "vitest";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const BUCKET_URL = `https://${ACCOUNT}.r2.cloudflarestorage.com/deni-files`;

vi.mock("@/env", () => ({
  env: {
    R2_ACCOUNT_ID: ACCOUNT,
    R2_ACCESS_KEY_ID: "access-key",
    R2_SECRET_ACCESS_KEY: "secret-key",
    R2_BUCKET: "deni-files",
  },
}));

const fetchMock = vi.fn(async (_request: Request) => new Response(null, { status: 200 }));

const {
  ATTACHMENT_EXPORT_URL_TTL_SECONDS,
  ATTACHMENT_FETCH_URL_TTL_SECONDS,
  ATTACHMENT_VIEW_URL_TTL_SECONDS,
  deleteStoredFiles,
  isStorageConfigured,
  isStoredFileUrl,
  signAttachmentUrl,
  uploadPrivateFile,
} = await import("./upload");
const { attachmentStorageKey, exportStorageKey, storageConfigFrom } =
  await import("./stored-files");

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("storage is configured only with every R2 setting, well-formed", () => {
  const complete = {
    R2_ACCOUNT_ID: ACCOUNT,
    R2_ACCESS_KEY_ID: "a",
    R2_SECRET_ACCESS_KEY: "s",
    R2_BUCKET: "deni-files",
  };
  expect(isStorageConfigured()).toBe(true);
  expect(storageConfigFrom(complete)).toMatchObject({ accountId: ACCOUNT, bucket: "deni-files" });
  expect(storageConfigFrom({ ...complete, R2_BUCKET: undefined })).toBeNull();
  expect(storageConfigFrom({ ...complete, R2_ACCOUNT_ID: "evil.example/x" })).toBeNull();
  expect(storageConfigFrom({ ...complete, R2_BUCKET: "../other" })).toBeNull();
});

test("keys derive from row ids", () => {
  expect(attachmentStorageKey("abc")).toBe("attachments/abc");
  expect(exportStorageKey("abc")).toBe("exports/abc");
});

test("files are stored as signed PUTs under their key, with their type and name", async () => {
  const file = new File(["xyz"], "写真 1.png", { type: "image/png" });
  expect(await uploadPrivateFile(file, "attachments/id-1")).toBe(true);
  const [request] = fetchMock.mock.calls[0]!;
  expect(request.method).toBe("PUT");
  expect(request.url).toBe(`${BUCKET_URL}/attachments/id-1`);
  expect(request.headers.get("content-type")).toBe("image/png");
  expect(request.headers.get("content-disposition")).toBe(
    `inline; filename="__ 1.png"; filename*=UTF-8''%E5%86%99%E7%9C%9F%201.png`,
  );
  expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=access-key\//);
  expect(await request.text()).toBe("xyz");
});

test("a file can be stored to download under its name rather than to show", async () => {
  const file = new File(["{}"], "deni-ai-export-2026-10-11.json", { type: "application/json" });
  expect(await uploadPrivateFile(file, "exports/id-1", { contentDisposition: "attachment" })).toBe(
    true,
  );
  const [request] = fetchMock.mock.calls[0]!;
  expect(request.headers.get("content-disposition")).toMatch(
    /^attachment; filename="deni-ai-export-2026-10-11.json"/,
  );
});

test("a failed upload returns false", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
  expect(await uploadPrivateFile(new File(["x"], "a.png"), "attachments/id")).toBe(false);
  fetchMock.mockRejectedValueOnce(new Error("network"));
  expect(await uploadPrivateFile(new File(["x"], "a.png"), "attachments/id")).toBe(false);
});

test("signed URLs are presigned locally with the requested lifetime", async () => {
  expect([
    ATTACHMENT_VIEW_URL_TTL_SECONDS,
    ATTACHMENT_FETCH_URL_TTL_SECONDS,
    ATTACHMENT_EXPORT_URL_TTL_SECONDS,
  ]).toEqual([600, 300, 900]);
  const url = new URL(await signAttachmentUrl("attachments/id-1", ATTACHMENT_VIEW_URL_TTL_SECONDS));
  expect(`${url.origin}${url.pathname}`).toBe(`${BUCKET_URL}/attachments/id-1`);
  expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
  expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(isStoredFileUrl(url)).toBe(true);
});

test("only URLs into the bucket are stored files", () => {
  expect(isStoredFileUrl(new URL(`${BUCKET_URL}/attachments/x`))).toBe(true);
  expect(isStoredFileUrl(new URL(`${BUCKET_URL}/`))).toBe(false);
  expect(
    isStoredFileUrl(new URL(`https://${ACCOUNT}.r2.cloudflarestorage.com/other-bucket/x`)),
  ).toBe(false);
  expect(isStoredFileUrl(new URL(`http://${ACCOUNT}.r2.cloudflarestorage.com/deni-files/x`))).toBe(
    false,
  );
  expect(isStoredFileUrl(new URL("https://app.ufs.sh/f/key"))).toBe(false);
});

test("stored files are deleted best effort, reporting the keys that are gone", async () => {
  fetchMock.mockImplementation(async (request: Request) => {
    const key = new URL(request.url).pathname.split("/").at(-1);
    if (key === "broken") return new Response(null, { status: 403 });
    if (key === "missing") return new Response(null, { status: 404 });
    return new Response(null, { status: 204 });
  });
  const deleted = await deleteStoredFiles(["a", "broken", "missing", "a", ""]);
  expect(deleted.toSorted()).toEqual(["a", "missing"]);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls.every(([request]) => request.method === "DELETE")).toBe(true);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));
});
