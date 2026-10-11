import { UTApi, UTFile } from "uploadthing/server";
import { env } from "@/env";
import { deleteFilesInBatches } from "@/lib/stored-files";

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

let utapi: UTApi | null = null;

if (env.UPLOADTHING_TOKEN) {
  utapi = new UTApi();
}

/** Whether UploadThing storage is configured. */
export function isStorageConfigured(): boolean {
  return utapi !== null;
}

/**
 * Upload a file to UploadThing as a private file. Returns its storage key (never a
 * public URL), or `null` when storage is not configured or the upload failed.
 *
 * `customId` is stored with the file (the attachment row id), so a file whose key
 * never reached the database can still be deleted with `deleteStoredFiles(ids, "customId")`.
 */
export async function uploadPrivateFile(file: File, customId: string): Promise<string | null> {
  if (!utapi) return null;

  try {
    const stored = new UTFile([file], file.name, {
      type: file.type,
      lastModified: file.lastModified,
      customId,
    });
    const response = await utapi.uploadFiles(stored, { acl: "private" });

    if (response.error) {
      console.error("[upload] UploadThing error:", response.error);
      return null;
    }

    return response.data.key;
  } catch (error) {
    console.error("[upload] Failed to upload file:", error);
    return null;
  }
}

/**
 * Sign a short-lived URL for a private file. Signing is local (no request to
 * UploadThing). Throws when storage is not configured.
 */
export async function signAttachmentUrl(key: string, expiresInSeconds: number): Promise<string> {
  if (!utapi) throw new Error("Attachment storage is not configured.");
  const { ufsUrl } = await utapi.generateSignedURL(key, { expiresIn: expiresInSeconds });
  return ufsUrl;
}

/**
 * Delete stored files in batches of 100, by storage key or by the custom id
 * given at upload. Best effort: failures are logged, not thrown. Returns the
 * keys that are gone, so a caller can keep a record of the rest to retry.
 */
export async function deleteStoredFiles(
  keys: readonly string[],
  keyType: "fileKey" | "customId" = "fileKey",
): Promise<string[]> {
  if (!utapi) return [];
  return deleteFilesInBatches(utapi, keys, keyType);
}
