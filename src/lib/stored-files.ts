import type { UTApi } from "uploadthing/server";

/**
 * Env-free helpers for files stored in UploadThing, shared by the app
 * (`@/lib/upload`, `@/lib/chat-text-attachments`) and the maintenance tools,
 * which do not load the app's environment validation.
 */

/** Keys per UploadThing delete or ACL request. */
export const STORAGE_BATCH_SIZE = 100;

/** Storage keys UploadThing hands out: URL-safe, no path separators. */
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9._~-]{1,256}$/;

/**
 * `<appId>.ufs.sh`, the host of this app's files, read from its UploadThing
 * token. `null` when the token is unset or not a valid token.
 */
export function uploadThingFileHostname(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    const appId =
      typeof decoded === "object" && decoded !== null && "appId" in decoded ? decoded.appId : null;
    return typeof appId === "string" && /^[a-z0-9]+$/i.test(appId)
      ? `${appId.toLowerCase()}.ufs.sh`
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether a URL is a file of this app (`https://<appId>.ufs.sh/f/...`). Message
 * parts come from the client, so any other URL (including another UploadThing
 * app's) must not be fetched or treated as one of ours.
 */
export function isStoredFileUrl(url: URL, hostname: string | null): boolean {
  return (
    hostname !== null &&
    url.protocol === "https:" &&
    url.hostname === hostname &&
    url.pathname.startsWith("/f/")
  );
}

/** The storage key of a URL of this app's files, or `null` for any other URL. */
export function storedFileKey(url: URL, hostname: string | null): string | null {
  if (!isStoredFileUrl(url, hostname)) return null;
  const key = url.pathname.slice("/f/".length);
  return STORAGE_KEY_PATTERN.test(key) ? key : null;
}

/**
 * Delete files in batches, by storage key or by the custom id given at upload.
 * Returns the keys of the batches UploadThing accepted (a key already gone
 * counts as deleted). Never throws: a failed batch is logged and left out.
 */
export async function deleteFilesInBatches(
  api: Pick<UTApi, "deleteFiles">,
  keys: readonly string[],
  keyType: "fileKey" | "customId",
): Promise<string[]> {
  const unique = [...new Set(keys.filter(Boolean))];
  const deleted: string[] = [];
  for (let start = 0; start < unique.length; start += STORAGE_BATCH_SIZE) {
    const batch = unique.slice(start, start + STORAGE_BATCH_SIZE);
    try {
      const { success } = await api.deleteFiles(batch, { keyType });
      if (!success) throw new Error("UploadThing reported a failed delete");
      deleted.push(...batch);
    } catch (error) {
      console.error(`[storage] Failed to delete ${batch.length} stored file(s):`, error);
    }
  }
  return deleted;
}
