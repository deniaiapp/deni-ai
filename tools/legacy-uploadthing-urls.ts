import { sql, type SQL } from "drizzle-orm";

import { attachmentUrl } from "../src/lib/attachment-url";

/**
 * Helpers of the UploadThing maintenance tools, mainly
 * `tools/migrate-legacy-chat-files.ts`, which moves files uploaded before
 * storage became private (still referenced by public UploadThing URLs in saved
 * chats) to R2 and the `/api/attachments/<id>` scheme. Saved messages are
 * untrusted JSON: anything that is not a well-formed file part is left alone.
 */

/** Keys of UploadThing file URLs (`<appId>.ufs.sh/f/<key>`, `utfs.io/f/<key>`, `utfs.io/a/<appId>/<key>`) of any app. */
const UPLOADTHING_URL = /(?:[a-z0-9]+\.ufs\.sh|utfs\.io)\/(?:f|a\/[a-z0-9]+)\/([A-Za-z0-9_-]+)/gi;

/** Keys of every UploadThing file URL anywhere in `text`, file part or not. */
export function uploadThingKeysInText(text: string | null): string[] {
  return text ? Array.from(text.matchAll(UPLOADTHING_URL), (match) => match[1]!) : [];
}

/** SQL condition: `text` mentions an UploadThing file host. */
export function mentionsUploadThing(text: SQL): SQL {
  return sql`(${text} like '%ufs.sh/%' or ${text} like '%utfs.io/%')`;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * The storage key of a public URL of this UploadThing app's files:
 * `https://<appId>.ufs.sh/f/<key>`, `https://utfs.io/f/<key>` or
 * `https://utfs.io/a/<appId>/<key>`. `null` for anything else, including
 * another app's host. `utfs.io/f/<key>` names no app: the caller only migrates
 * keys this app's file listing has.
 */
export function uploadThingUrlKey(value: string, appId: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const segments = url.pathname.split("/").slice(1);
  let key: string | undefined;
  if (url.hostname === `${appId}.ufs.sh` && segments.length === 2 && segments[0] === "f") {
    key = segments[1];
  } else if (url.hostname === "utfs.io" && segments.length === 2 && segments[0] === "f") {
    key = segments[1];
  } else if (
    url.hostname === "utfs.io" &&
    segments.length === 3 &&
    segments[0] === "a" &&
    segments[1] === appId
  ) {
    key = segments[2];
  }
  return key && KEY_PATTERN.test(key) ? key : null;
}

function fileKey(part: unknown, appId: string): string | null {
  if (!isRecord(part) || part.type !== "file" || typeof part.url !== "string") return null;
  return uploadThingUrlKey(part.url, appId);
}

function messageParts(messages: unknown): unknown[][] {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) =>
    isRecord(message) && Array.isArray(message.parts) ? [message.parts] : [],
  );
}

/**
 * Files referenced by file parts with public URLs of this app's storage:
 * storage key to the media type of its first such part.
 */
export function findLegacyFiles(messages: unknown, appId: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const parts of messageParts(messages)) {
    for (const part of parts) {
      const key = fileKey(part, appId);
      if (!key || found.has(key)) continue;
      const mediaType = isRecord(part) && typeof part.mediaType === "string" ? part.mediaType : "";
      found.set(key, mediaType || "application/octet-stream");
    }
  }
  return found;
}

/**
 * Point those file parts at their app URL (`/api/attachments/<id>`), for the
 * keys in `idsByKey`; every other part is kept as is. `rewritten` counts the
 * changed parts (0: nothing to save). Running it again changes nothing: an app
 * URL is not a storage URL.
 */
export function rewriteLegacyFileUrls(
  messages: unknown,
  appId: string,
  idsByKey: ReadonlyMap<string, string>,
): { messages: unknown; rewritten: number } {
  if (!Array.isArray(messages)) return { messages, rewritten: 0 };
  let rewritten = 0;
  const result = messages.map((message) => {
    if (!isRecord(message) || !Array.isArray(message.parts)) return message;
    let changed = false;
    const parts = message.parts.map((part: unknown) => {
      const key = fileKey(part, appId);
      const id = key === null ? undefined : idsByKey.get(key);
      if (id === undefined || !isRecord(part)) return part;
      changed = true;
      rewritten++;
      return { ...part, url: attachmentUrl(id) };
    });
    return changed ? { ...message, parts } : message;
  });
  return { messages: rewritten > 0 ? result : messages, rewritten };
}
