import { timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { cleanUpAttachmentStorage } from "@/lib/attachments";
import { isStorageConfigured } from "@/lib/upload";

export const maxDuration = 300;

/**
 * Attachment storage cleanup, scheduled hourly (see SETUP.md): deletes the
 * files and rows of uploads abandoned for over an hour, of files untied from
 * any chat for over a day, and of rows an earlier deletion left marked. Each
 * run handles a bounded batch; the next run continues.
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
  // 503 while files fail to delete, so the scheduler alerts; their rows stay for the next run.
  return Response.json(result, { status: result.failed > 0 ? 503 : 200, headers });
}
