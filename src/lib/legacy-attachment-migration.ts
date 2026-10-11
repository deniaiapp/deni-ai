import { attachmentUrl } from "@/lib/attachment-url";
import { storedFileKey } from "@/lib/stored-files";

/**
 * Pure helpers of `tools/migrate-private-attachments.ts`, which moves files
 * uploaded before storage became private to the `/api/attachments/<id>` scheme.
 * Saved messages are untrusted JSON: anything that is not a well-formed file
 * part is left alone.
 */

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The storage key of a file part whose URL is a public URL of this app's files. */
function legacyKey(part: unknown, hostname: string): string | null {
  if (!isRecord(part) || part.type !== "file" || typeof part.url !== "string") return null;
  let url: URL;
  try {
    url = new URL(part.url);
  } catch {
    return null;
  }
  return storedFileKey(url, hostname);
}

function messageParts(messages: unknown): unknown[][] {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) =>
    isRecord(message) && Array.isArray(message.parts) ? [message.parts] : [],
  );
}

/**
 * Files referenced by public URLs of this app's storage
 * (`https://<appId>.ufs.sh/f/<key>`) in saved messages: storage key to the
 * media type of its first file part.
 */
export function findLegacyAttachments(messages: unknown, hostname: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const parts of messageParts(messages)) {
    for (const part of parts) {
      const key = legacyKey(part, hostname);
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
export function rewriteLegacyAttachmentUrls(
  messages: unknown,
  hostname: string,
  idsByKey: ReadonlyMap<string, string>,
): { messages: unknown; rewritten: number } {
  if (!Array.isArray(messages)) return { messages, rewritten: 0 };
  let rewritten = 0;
  const result = messages.map((message) => {
    if (!isRecord(message) || !Array.isArray(message.parts)) return message;
    let changed = false;
    const parts = message.parts.map((part: unknown) => {
      const key = legacyKey(part, hostname);
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
