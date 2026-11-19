import { cleanUpAccountExports } from "@/lib/account-export-jobs";
import { cleanUpAttachmentStorage } from "@/lib/attachments";
import { isStorageConfigured } from "@/lib/upload";

export type StorageCleanupJobResult =
  | { storageConfigured: false; healthy: true }
  | {
      storageConfigured: true;
      marked: number;
      deleted: number;
      failed: number;
      exports: { deleted: number; failed: number };
      healthy: boolean;
    };

/**
 * One storage cleanup run: run hourly in-process by a production server
 * (`background-job-scheduler.ts`), or triggered through
 * `/api/cron/storage-cleanup`. Deletes the files and rows of uploads abandoned
 * for over an hour, of files untied from any chat for over a day, and of rows
 * an earlier deletion left marked, then those of expired data exports. Each
 * run handles a bounded batch; the next run continues. `healthy` is false
 * while files fail to delete (their rows stay for the next run).
 *
 * Safe on several replicas at once: marking re-checks each row's expiry in the
 * UPDATE, `deleting` is final, rows are deleted only once their file is gone,
 * and a second delete of the same file or row changes nothing.
 */
export async function runStorageCleanupJob(): Promise<StorageCleanupJobResult> {
  // Without storage nothing is stored (uploads travel inline), and nothing could be deleted.
  if (!isStorageConfigured()) return { storageConfigured: false, healthy: true };
  const result = await cleanUpAttachmentStorage();
  const exports = await cleanUpAccountExports();
  return {
    storageConfigured: true,
    ...result,
    exports,
    healthy: result.failed === 0 && exports.failed === 0,
  };
}
