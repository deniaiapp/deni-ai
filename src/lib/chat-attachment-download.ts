import type { Experimental_DownloadFunction as DownloadFunction, UIMessage } from "ai";
import { fetchSafePublicHttpUrl, isBlockedHostnameLiteral } from "@/lib/network-security";

export const MAX_CHAT_BINARY_ATTACHMENTS = 20;
export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_CONCURRENT_DOWNLOADS = 4;

type DownloadedAttachment = { data: Uint8Array; mediaType: string | undefined };
/** Downloaded attachment bytes by URL, shared by the budget check and the SDK. */
export type ChatAttachmentCache = Map<string, DownloadedAttachment>;

/** Bound binary history just as text history is bounded before entering the SDK. */
export function prepareBinaryAttachments(messages: UIMessage[]): UIMessage[] {
  const files = messages.flatMap((message) => message.parts.filter((part) => part.type === "file"));
  const kept = new Set(files.slice(-MAX_CHAT_BINARY_ATTACHMENTS));
  for (const file of kept) {
    if (!file.mediaType.startsWith("image/") && file.mediaType !== "application/pdf")
      throw new Error("Unsupported attachment type.");
    if (file.url.startsWith("data:")) {
      const comma = file.url.indexOf(",");
      const metadata = file.url.slice(0, comma);
      const payload = file.url.slice(comma + 1);
      if (
        comma < 0 ||
        !metadata.endsWith(";base64") ||
        payload.length > 4 * Math.ceil(MAX_CHAT_ATTACHMENT_BYTES / 3)
      )
        throw new Error("Attachment is too large or invalid.");
      // The SDK sends a data URL with its own media type, not the declared one.
      if (metadata.slice(5).split(";", 1)[0].toLowerCase() !== file.mediaType.toLowerCase())
        throw new Error("Unsupported attachment type.");
    } else {
      const url = new URL(file.url);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        isBlockedHostnameLiteral(url.hostname)
      )
        throw new Error("Invalid attachment URL.");
    }
  }
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === "file" && !kept.has(part)
        ? {
            type: "text" as const,
            text: "[An older attachment was left out: at most 20 binary attachments can be sent per request.]",
          }
        : part,
    ),
  }));
}

/**
 * Fetch through the SSRF-safe transport with a per-file byte cap. Returns
 * `undefined` once `accept` rejects the size read so far.
 */
async function downloadAttachment(
  url: URL,
  signal: AbortSignal,
  accept: (size: number) => boolean,
): Promise<DownloadedAttachment | undefined> {
  let target = url;
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await fetchSafePublicHttpUrl(target.href, { signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location || redirects === 5) throw new Error("Invalid attachment redirect.");
    target = new URL(location, target);
  }
  if (!response?.ok || !response.body) {
    await response?.body?.cancel();
    throw new Error("Attachment download failed.");
  }
  if (Number(response.headers.get("content-length")) > MAX_CHAT_ATTACHMENT_BYTES) {
    await response.body.cancel();
    throw new Error("Attachment is too large.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CHAT_ATTACHMENT_BYTES) throw new Error("Attachments are too large.");
      if (!accept(size)) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { data, mediaType: response.headers.get("content-type")?.split(";", 1)[0] ?? undefined };
}

/**
 * Fit the attachments sent to the model into the byte budget, newest first.
 * URL files are downloaded into `cache` for the SDK to reuse. Older files that
 * no longer fit are left out instead of failing the request, so a chat whose
 * history passes the budget keeps working.
 */
export async function fitBinaryAttachmentsToBudget(
  messages: UIMessage[],
  cache: ChatAttachmentCache,
  signal: AbortSignal,
): Promise<UIMessage[]> {
  // Newest first. The SDK only downloads URL files from user messages.
  const files = messages
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "file" && (message.role === "user" || part.url.startsWith("data:"))
          ? [part]
          : [],
      ),
    )
    .reverse();
  // Bytes seen so far per file. A file is kept only while it and every newer
  // file fit the budget together, so a download stops as soon as that sum
  // passes the budget, and every older file is left out with it.
  const sizes = files.map((file) =>
    file.url.startsWith("data:")
      ? Buffer.byteLength(file.url.slice(file.url.indexOf(",") + 1), "base64")
      : 0,
  );
  const fits = (index: number) =>
    sizes.slice(0, index + 1).reduce((total, size) => total + size, 0) <= MAX_TOTAL_BYTES;
  // Each URL is downloaded once, at its newest position.
  const positions = new Map<string, number>();
  files.forEach((file, index) => {
    const href = file.url.startsWith("data:") ? undefined : new URL(file.url).href;
    if (href && !positions.has(href)) positions.set(href, index);
  });
  const queue = [...positions];
  const downloaded = new Map<string, DownloadedAttachment>();
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_DOWNLOADS, queue.length) }, async () => {
      while (next < queue.length) {
        const [href, index] = queue[next++];
        if (!fits(index)) continue;
        const file = await downloadAttachment(new URL(href), timeout, (size) => {
          sizes[index] = size;
          return fits(index);
        });
        if (file) downloaded.set(href, file);
      }
    }),
  );
  for (const [href, index] of queue) {
    const file = downloaded.get(href);
    if (file && fits(index)) cache.set(href, file);
  }
  const leftOut = new Set(files.filter((_, index) => !fits(index)));
  if (leftOut.size === 0) return messages;
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === "file" && leftOut.has(part)
        ? {
            type: "text" as const,
            text: "[An older attachment was left out: attachments sent per request can total at most 20 MB.]",
          }
        : part,
    ),
  }));
}

/** Keep connect-time SSRF protection, cap bytes, and share downloads across provider steps. */
export function createChatAttachmentDownload(
  signal: AbortSignal,
  cache: ChatAttachmentCache = new Map(),
): DownloadFunction {
  let totalBytes = 0;
  for (const file of cache.values()) totalBytes += file.data.byteLength;
  return async (requested) => {
    if (requested.length > MAX_CHAT_BINARY_ATTACHMENTS) throw new Error("Too many attachments.");
    const urls = [...new Map(requested.map(({ url }) => [url.href, url])).values()];
    let next = 0;
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    async function download(url: URL) {
      if (cache.has(url.href)) return;
      let counted = 0;
      const file = await downloadAttachment(url, timeout, (size) => {
        totalBytes += size - counted;
        counted = size;
        return totalBytes <= MAX_TOTAL_BYTES;
      });
      if (!file) throw new Error("Attachments are too large.");
      cache.set(url.href, file);
    }
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_DOWNLOADS, urls.length) }, async () => {
        while (next < urls.length) await download(urls[next++]);
      }),
    );
    return requested.map(({ url }) => cache.get(url.href)!);
  };
}
