import { timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { runStorageCleanupJob } from "@/lib/storage-cleanup-job";

/**
 * Manual or external trigger of the attachment and export storage cleanup that
 * a production server already runs hourly in-process (see SETUP.md and
 * `runStorageCleanupJob`).
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
  const { healthy, storageConfigured, ...result } = await runStorageCleanupJob();
  if (!storageConfigured) return Response.json({ storageConfigured }, { headers });
  // 503 while files fail to delete, so an external scheduler alerts; their rows stay for the next run.
  return Response.json(result, { status: healthy ? 200 : 503, headers });
}
