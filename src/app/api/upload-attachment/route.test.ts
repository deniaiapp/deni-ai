import { beforeEach, expect, test, vi } from "vitest";

const ATTACHMENT_ID = "a".repeat(32);
const STORAGE_KEY = `attachments/${ATTACHMENT_ID}`;

const mocks = vi.hoisted(() => ({
  session: { session: { userId: "user" }, user: { isAnonymous: false } } as unknown,
  allowed: true,
  configured: true,
  uploadFile: vi.fn(async (_file: File, _key: string): Promise<boolean> => true),
  // Reports every file as deleted unless a test says otherwise.
  deleteStoredFiles: vi.fn(async (keys: readonly string[]): Promise<string[]> => [...keys]),
  limit: vi.fn(async (_userId: string, _isAnonymous: boolean) => 100 * 1024 * 1024),
  reserve: vi.fn(
    async (_input: {
      userId: string;
      mediaType: string;
      sizeBytes: number;
      limitBytes: number;
    }): Promise<
      { ok: true; id: string } | { ok: false; usedBytes: number; limitBytes: number }
    > => ({ ok: true, id: "a".repeat(32) }),
  ),
  markReady: vi.fn(async (_id: string, _key: string) => true),
  release: vi.fn(async (_id: string) => {}),
  abandon: vi.fn(async (_id: string) => {}),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => mocks.session } } }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () =>
    mocks.allowed ? { allowed: true } : { allowed: false, retryAfter: 60 },
}));
vi.mock("@/lib/upload", () => ({
  isStorageConfigured: () => mocks.configured,
  uploadPrivateFile: mocks.uploadFile,
  deleteStoredFiles: mocks.deleteStoredFiles,
}));
vi.mock("@/lib/attachments", () => ({
  getStorageLimitForUser: mocks.limit,
  reserveAttachmentStorage: mocks.reserve,
  markAttachmentReady: mocks.markReady,
  releaseAttachmentReservation: mocks.release,
  abandonAttachmentReservation: mocks.abandon,
}));

import { POST } from "./route";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function upload(bytes: Uint8Array<ArrayBuffer>, type: string) {
  const body = new FormData();
  body.set("file", new File([bytes], "attachment", { type }));
  return POST(new Request("https://app.example/api/upload-attachment", { method: "POST", body }));
}

beforeEach(() => {
  mocks.session = { session: { userId: "user" }, user: { isAnonymous: false } };
  mocks.allowed = true;
  mocks.configured = true;
  for (const mock of [
    mocks.uploadFile,
    mocks.deleteStoredFiles,
    mocks.limit,
    mocks.reserve,
    mocks.markReady,
    mocks.release,
    mocks.abandon,
  ]) {
    mock.mockClear();
  }
});

test("rejects files whose contents are not an allowed type", async () => {
  const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
  const response = await upload(html, "image/png");
  expect(response.status).toBe(415);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
});

test("stores a file under the type its contents prove", async () => {
  const response = await upload(PNG, "image/jpeg");
  expect(response.status).toBe(200);
  expect(mocks.uploadFile.mock.calls[0]?.[0].type).toBe("image/png");
});

test("accepts a file whose browser-reported type is empty", async () => {
  const response = await upload(PNG, "");
  expect(response.status).toBe(200);
  expect(mocks.uploadFile.mock.calls[0]?.[0].type).toBe("image/png");
});

function uploadNamed(bytes: Uint8Array<ArrayBuffer>, name: string, type = "") {
  const body = new FormData();
  body.set("file", new File([bytes], name, { type }));
  return POST(new Request("https://app.example/api/upload-attachment", { method: "POST", body }));
}

const text = (value: string) => new TextEncoder().encode(value);

test("accepts a JSON file and stores it as application/json", async () => {
  const response = await uploadNamed(text('{"a":1}'), "data.json", "application/json");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url: `/api/attachments/${ATTACHMENT_ID}`,
    mediaType: "application/json",
  });
  expect(mocks.uploadFile.mock.calls[0]?.[0].type).toBe("application/json");
});

test("stores HTML and source files as plain text so they never render", async () => {
  for (const name of ["page.html", "script.py", "notes.txt"]) {
    mocks.uploadFile.mockClear();
    const response = await uploadNamed(text("<b>hi</b>"), name, "text/html");
    expect(response.status).toBe(200);
    expect(mocks.uploadFile.mock.calls[0]?.[0].type).toBe("text/plain");
  }
});

test("converts Shift_JIS text to UTF-8 before storing it", async () => {
  // "日本語" in Shift_JIS.
  const sjis = new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]);
  const response = await uploadNamed(sjis, "data.csv", "text/csv");
  expect(response.status).toBe(200);
  const stored = mocks.uploadFile.mock.calls[0]?.[0] as File;
  expect(stored.type).toBe("text/csv");
  expect(await stored.text()).toBe("日本語");
});

test("rejects binary data, unknown extensions and unsafe types", async () => {
  const binary = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
  expect((await uploadNamed(binary, "data.json")).status).toBe(415);
  expect((await uploadNamed(text("MZ"), "run.exe")).status).toBe(415);
  expect((await uploadNamed(text("<svg/>"), "image.svg", "image/svg+xml")).status).toBe(415);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
});

test("limits text files to 2 MB", async () => {
  const large = new Uint8Array(2 * 1024 * 1024 + 1).fill(0x61);
  expect((await uploadNamed(large, "big.txt")).status).toBe(413);
});

test("applies the 2 MB text limit to the stored UTF-8 bytes", async () => {
  // Half-width katakana "ｱ" is one byte in Shift_JIS and three in UTF-8.
  const sjisKana = new Uint8Array(1024 * 1024).fill(0xb1);
  expect((await uploadNamed(sjisKana, "data.csv")).status).toBe(413);
  expect(mocks.uploadFile).not.toHaveBeenCalled();

  const fits = new Uint8Array(512 * 1024).fill(0xb1);
  expect((await uploadNamed(fits, "data.csv")).status).toBe(200);
  const stored = mocks.uploadFile.mock.calls[0]?.[0] as File;
  expect(stored.size).toBe(3 * 512 * 1024);
});

test("rate-limits uploads per account", async () => {
  mocks.allowed = false;
  const response = await upload(PNG, "image/png");
  expect(response.status).toBe(429);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
});

test("cross-site upload forms cannot store files using a victim's session", async () => {
  const body = new FormData();
  body.set("file", new File([PNG], "image.png", { type: "image/png" }));
  const response = await POST(
    new Request("https://app.example/api/upload-attachment", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
      body,
    }),
  );
  expect(response.status).toBe(403);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
});

test("rejects an oversized body that arrives without a Content-Length", async () => {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 1;
      controller.enqueue(chunk);
      if (sent >= 40) controller.close();
    },
  });
  const response = await POST(
    new Request("https://app.example/api/upload-attachment", {
      method: "POST",
      body,
      headers: { "content-type": "multipart/form-data; boundary=x" },
      // @ts-expect-error Node's fetch requires `duplex` for streaming bodies.
      duplex: "half",
    }),
  );
  expect(response.status).toBe(413);
  expect(sent).toBeLessThan(20);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
});

test("stores the file privately and returns the app URL, never the storage URL", async () => {
  const response = await upload(PNG, "image/png");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url: `/api/attachments/${ATTACHMENT_ID}`,
    mediaType: "image/png",
  });
  expect(mocks.limit).toHaveBeenCalledWith("user", false);
  expect(mocks.reserve).toHaveBeenCalledWith({
    userId: "user",
    mediaType: "image/png",
    sizeBytes: PNG.byteLength,
    limitBytes: 100 * 1024 * 1024,
  });
  expect(mocks.markReady).toHaveBeenCalledWith(ATTACHMENT_ID, STORAGE_KEY);
  // Keyed by the reservation id, so the file can be found even if its key is lost.
  expect(mocks.uploadFile.mock.calls[0]?.[1]).toBe(STORAGE_KEY);
  // Quota is reserved before anything is stored.
  expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.uploadFile.mock.invocationCallOrder[0] ?? 0,
  );
});

test("guests are held to the guest quota", async () => {
  mocks.session = { session: { userId: "guest" }, user: { isAnonymous: true } };
  expect((await upload(PNG, "image/png")).status).toBe(200);
  expect(mocks.limit).toHaveBeenCalledWith("guest", true);
});

test("an upload past the storage quota is rejected before anything is stored", async () => {
  mocks.reserve.mockResolvedValueOnce({
    ok: false,
    usedBytes: 99.5 * 1024 * 1024,
    limitBytes: 100 * 1024 * 1024,
  });
  const response = await upload(PNG, "image/png");
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({
    error:
      "Attachment storage is full (99.5 MB of 100 MB used). Delete chats with attachments or upgrade your plan.",
    reason: "storage_quota_exceeded",
    usedBytes: 99.5 * 1024 * 1024,
    limitBytes: 100 * 1024 * 1024,
  });
  expect(mocks.uploadFile).not.toHaveBeenCalled();
});

test("a failed upload gives the quota back instead of falling back to an inline copy", async () => {
  mocks.uploadFile.mockResolvedValueOnce(false);
  const response = await upload(PNG, "image/png");
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "Attachment upload failed." });
  expect(mocks.release).toHaveBeenCalledWith(ATTACHMENT_ID);
  expect(mocks.abandon).not.toHaveBeenCalled();
  expect(mocks.markReady).not.toHaveBeenCalled();
  // The request may have failed after the file was stored.
  expect(mocks.deleteStoredFiles).toHaveBeenCalledExactlyOnceWith([STORAGE_KEY]);
});

test("a stored file whose record cannot be saved is deleted again", async () => {
  mocks.markReady.mockResolvedValueOnce(false);
  const response = await upload(PNG, "image/png");
  expect(response.status).toBe(500);
  expect(mocks.deleteStoredFiles).toHaveBeenCalledWith([STORAGE_KEY]);
  expect(mocks.release).toHaveBeenCalledWith(ATTACHMENT_ID);
  expect(mocks.abandon).not.toHaveBeenCalled();
});

test("a file that could not be deleted again keeps its reservation for the cleanup", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  // The upload failed after storing the file, and R2 is still failing.
  mocks.uploadFile.mockResolvedValueOnce(false);
  mocks.deleteStoredFiles.mockResolvedValueOnce([]);
  expect((await upload(PNG, "image/png")).status).toBe(502);
  // Dropping the row would leave the file untracked: it is marked for deletion
  // instead, which gives the quota back and lets the cron delete the file by its key.
  expect(mocks.release).not.toHaveBeenCalled();
  expect(mocks.abandon).toHaveBeenCalledExactlyOnceWith(ATTACHMENT_ID);

  mocks.abandon.mockClear();
  mocks.markReady.mockRejectedValueOnce(new Error("database unavailable"));
  mocks.deleteStoredFiles.mockResolvedValueOnce([]);
  expect((await upload(PNG, "image/png")).status).toBe(500);
  expect(mocks.deleteStoredFiles).toHaveBeenLastCalledWith([STORAGE_KEY]);
  expect(mocks.release).not.toHaveBeenCalled();
  expect(mocks.abandon).toHaveBeenCalledExactlyOnceWith(ATTACHMENT_ID);
});

test("without storage configured, small files are returned inline with no quota", async () => {
  mocks.configured = false;
  const response = await upload(PNG, "image/png");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`,
    mediaType: "image/png",
  });
  expect(mocks.reserve).not.toHaveBeenCalled();
  expect(mocks.uploadFile).not.toHaveBeenCalled();
});
