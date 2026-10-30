import { timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { runGuestCleanupJob } from "@/lib/guest-cleanup-job";

/**
 * Manual or external trigger of the abandoned guest cleanup that a production
 * server already runs hourly in-process (see SETUP.md and `runGuestCleanupJob`).
 */
export async function GET(request: Request) {
  if (!env.CRON_SECRET)
    return Response.json({ error: "Guest cleanup is disabled" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return new Response(null, { status: 401 });
  }
  const { healthy, ...result } = await runGuestCleanupJob();
  // 503 while guests fail to delete, so an external scheduler alerts; they stay for the next run.
  return Response.json(result, {
    status: healthy ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
