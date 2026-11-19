import { env } from "@/env";
import {
  contentDispositionHeader,
  createFileStorage,
  type FileStorage,
  storageConfigFrom,
} from "@/lib/stored-files";

/**
 * Lifetimes of signed storage URLs. Files are private: every URL handed out
 * expires, and a fresh one is signed each time access is checked.
 */
/** Browser redirects from `/api/attachments/<id>`. */
export const ATTACHMENT_VIEW_URL_TTL_SECONDS = 600;
/** Server-side fetches (for example, sending a file to the model). */
export const ATTACHMENT_FETCH_URL_TTL_SECONDS = 300;
/** Links included in data exports. */
export const ATTACHMENT_EXPORT_URL_TTL_SECONDS = 900;

const storageConfig = storageConfigFrom(env);
const storage: FileStorage | null = storageConfig ? createFileStorage(storageConfig) : null;

/** Whether R2 storage is configured. */
export function isStorageConfigured(): boolean {
  return storage !== null;
}

/**
 * Upload a file to R2 as a private object under `key` (see
 * `attachmentStorageKey` and `exportStorageKey`). Returns whether it was
 * stored: false when storage is not configured or the upload failed.
 *
 * `contentDisposition: "attachment"` makes its signed URL download the file
 * under its name instead of showing it (data exports).
 */
export async function uploadPrivateFile(
  file: File,
  key: string,
  { contentDisposition }: { contentDisposition?: "inline" | "attachment" } = {},
): Promise<boolean> {
  if (!storage) return false;

  try {
    await storage.put(key, file, {
      contentType: file.type || "application/octet-stream",
      contentDisposition: contentDispositionHeader(
        contentDisposition ?? "inline",
        file.name || "file",
      ),
    });
    return true;
  } catch (error) {
    console.error("[upload] Failed to upload file:", error);
    return false;
  }
}

/**
 * Sign a short-lived URL for a private file. Signing is local (no request to
 * R2). Throws when storage is not configured.
 */
export async function signAttachmentUrl(key: string, expiresInSeconds: number): Promise<string> {
  if (!storage) throw new Error("Attachment storage is not configured.");
  return storage.sign(key, expiresInSeconds);
}

/**
 * Delete stored files by storage key. Best effort: failures are logged, not
 * thrown. Returns the keys that are gone, so a caller can keep a record of the
 * rest to retry.
 */
export async function deleteStoredFiles(keys: readonly string[]): Promise<string[]> {
  if (!storage) return [];
  return storage.delete(keys);
}

/** Whether a URL is a signed URL of this app's storage (see `FileStorage.isFileUrl`). */
export function isStoredFileUrl(url: URL): boolean {
  return storage?.isFileUrl(url) ?? false;
}
