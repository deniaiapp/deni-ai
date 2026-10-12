import { timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { cleanUpAccountExports } from "@/lib/account-export-jobs";
import { cleanUpAttachmentStorage } from "@/lib/attachments";
import { isStorageConfigured } from "@/lib/upload";

export const maxDuration = 300;

/**
 * Attachment storage cleanup, scheduled hourly (see SETUP.md): deletes the
 * files and rows of uploads abandoned for over an hour, of files untied from
 * any chat for over a day, and of rows an earlier deletion left marked, then
 * those of expired data exports. Each run handles a bounded batch; the next
 * run continues.
 */
export async function GET(request: Request) {
  if (!env.CRON_SECRET)
    return Response.json({ error: "Storage cleanup is disabled" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return new Response(null, { status: 401 });
  }
  const headers = { "Cache-Control": "no-store" };
  // Without storage nothing is stored (uploads travel inline), and nothing could be deleted.
  if (!isStorageConfigured()) return Response.json({ storageConfigured: false }, { headers });
  const result = await cleanUpAttachmentStorage();
  const exports = await cleanUpAccountExports();
  // 503 while files fail to delete, so the scheduler alerts; their rows stay for the next run.
  const failed = result.failed > 0 || exports.failed > 0;
  return Response.json({ ...result, exports }, { status: failed ? 503 : 200, headers });
}
