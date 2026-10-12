import type { UIMessage } from "ai";
import { beforeEach, expect, test, vi } from "vitest";
import { fetchSafePublicHttpUrl } from "./network-security";
import {
  createChatAttachmentDownload,
  fitBinaryAttachmentsToBudget,
  prepareBinaryAttachments,
  MAX_CHAT_ATTACHMENT_BYTES,
  type ChatAttachmentCache,
} from "./chat-attachment-download";
vi.mock("./network-security", async () => ({
  ...(await vi.importActual<typeof import("./network-security")>("./network-security")),
  fetchSafePublicHttpUrl: vi.fn(),
}));
beforeEach(() => vi.mocked(fetchSafePublicHttpUrl).mockReset());
const request = (url = "https://files.example/image", isUrlSupportedByModel = false) => ({
  url: new URL(url),
  isUrlSupportedByModel,
});
const file = (url: string): UIMessage => ({
  id: "user",
  role: "user",
  parts: [{ type: "file", mediaType: "image/png", url }],
});

test.each([
  "http://127.0.0.1/a",
  "http://169.254.169.254/a",
  "file:///etc/passwd",
  "https://user:secret@files.example/a",
])("rejects unsafe binary source %s before SDK conversion", (url) => {
  expect(() => prepareBinaryAttachments([file(url)])).toThrow("attachment URL");
});
test("retains only the latest twenty binary history attachments", () => {
  const result = prepareBinaryAttachments(
    Array.from({ length: 21 }, (_, index) => file(`https://files.example/${index}`)),
  );
  expect(result[0].parts[0].type).toBe("text");
  expect(result.slice(1).every((message) => message.parts[0].type === "file")).toBe(true);
});
test("direct data attachments cannot bypass the upload byte limit", () => {
  expect(() =>
    prepareBinaryAttachments([
      file(`data:image/png;base64,${"A".repeat(4 * Math.ceil(MAX_CHAT_ATTACHMENT_BYTES / 3) + 4)}`),
    ]),
  ).toThrow("too large");
});
test("bounds files even when the provider would accept an arbitrary URL", async () => {
  const cancel = vi.fn();
  vi.mocked(fetchSafePublicHttpUrl).mockResolvedValue(
    new Response(new ReadableStream({ cancel }), {
      headers: { "content-length": String(MAX_CHAT_ATTACHMENT_BYTES + 1) },
    }),
  );
  await expect(
    createChatAttachmentDownload(new AbortController().signal)([request(undefined, true)]),
  ).rejects.toThrow("too large");
  expect(cancel).toHaveBeenCalledOnce();
});
test("cancels chunked responses as soon as their byte cap is exceeded", async () => {
  let chunks = 0;
  const cancel = vi.fn();
  vi.mocked(fetchSafePublicHttpUrl).mockResolvedValue(
    new Response(
      new ReadableStream({
        pull(controller) {
          chunks++;
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel,
      }),
    ),
  );
  await expect(
    createChatAttachmentDownload(new AbortController().signal)([request()]),
  ).rejects.toThrow("too large");
  expect(chunks).toBeLessThan(14);
  expect(cancel).toHaveBeenCalledOnce();
});
test("limits total downloaded bytes across attachments", async () => {
  vi.mocked(fetchSafePublicHttpUrl).mockImplementation(
    async () => new Response(new Uint8Array(8 * 1024 * 1024)),
  );
  await expect(
    createChatAttachmentDownload(new AbortController().signal)([
      request("https://files.example/a"),
      request("https://files.example/b"),
      request("https://files.example/c"),
    ]),
  ).rejects.toThrow("too large");
});
test("a data URL must carry the declared media type the SDK will not use", () => {
  expect(() =>
    prepareBinaryAttachments([
      {
        id: "user",
        role: "user",
        parts: [{ type: "file", mediaType: "image/png", url: "data:audio/mpeg;base64,AAAA" }],
      },
    ]),
  ).toThrow("Unsupported attachment type");
  expect(() => prepareBinaryAttachments([file("data:IMAGE/PNG;base64,AAAA")])).not.toThrow();
});
test("leaves out the oldest attachments beyond the byte budget instead of failing", async () => {
  vi.mocked(fetchSafePublicHttpUrl).mockImplementation(
    async () => new Response(new Uint8Array(8 * 1024 * 1024)),
  );
  const cache: ChatAttachmentCache = new Map();
  const history = ["a", "b", "c"].map((name) => file(`https://files.example/${name}`));
  const result = await fitBinaryAttachmentsToBudget(history, cache, new AbortController().signal);
  expect(result[0].parts[0]).toMatchObject({
    type: "text",
    text: expect.stringContaining("left out"),
  });
  expect(result.slice(1).map((message) => message.parts[0].type)).toEqual(["file", "file"]);
  expect([...cache.keys()].sort()).toEqual(["https://files.example/b", "https://files.example/c"]);
  // The SDK reuses the kept downloads instead of fetching again.
  const downloaded = await createChatAttachmentDownload(
    new AbortController().signal,
    cache,
  )([request("https://files.example/b"), request("https://files.example/c")]);
  expect(downloaded.every((entry) => entry?.data.byteLength === 8 * 1024 * 1024)).toBe(true);
  expect(fetchSafePublicHttpUrl).toHaveBeenCalledTimes(3);
});
test("keeps every attachment that fits the byte budget", async () => {
  vi.mocked(fetchSafePublicHttpUrl).mockImplementation(async () => new Response("image"));
  const history = [file("https://files.example/a"), file("data:image/png;base64,AAAA")];
  const cache: ChatAttachmentCache = new Map();
  expect(await fitBinaryAttachmentsToBudget(history, cache, new AbortController().signal)).toBe(
    history,
  );
  expect(cache.has("https://files.example/a")).toBe(true);
});
test("deduplicates downloads within a request and across provider steps", async () => {
  vi.mocked(fetchSafePublicHttpUrl).mockImplementation(
    async () => new Response("image", { headers: { "content-type": "image/png" } }),
  );
  const download = createChatAttachmentDownload(new AbortController().signal);
  const first = await download([request(), request()]);
  expect(first[0]).toBe(first[1]);
  expect((await download([request()]))[0]).toBe(first[0]);
  expect(fetchSafePublicHttpUrl).toHaveBeenCalledOnce();
});
test("validates each redirect through the protected transport", async () => {
  vi.mocked(fetchSafePublicHttpUrl)
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    )
    .mockRejectedValueOnce(new Error("Private network"));
  await expect(
    createChatAttachmentDownload(new AbortController().signal)([request()]),
  ).rejects.toThrow("Private network");
  expect(fetchSafePublicHttpUrl).toHaveBeenLastCalledWith(
    "http://169.254.169.254/latest/meta-data",
    expect.anything(),
  );
});
