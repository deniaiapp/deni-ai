import { timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { cronDisabledResponse, cronEnabled } from "@/lib/deployment-flags";
import { runSubscriptionEndingReminderJob } from "@/lib/subscription-ending-reminder-job";

/**
 * Manual or external trigger of the "your plan ends soon" emails that a production
 * server already sends hourly in-process (see SETUP.md and
 * `runSubscriptionEndingReminderJob`).
 */
export async function GET(request: Request) {
  if (!cronEnabled()) return cronDisabledResponse();
  if (!env.CRON_SECRET)
    return Response.json({ error: "Subscription reminders are disabled" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return new Response(null, { status: 401 });
  }
  const { healthy, ...result } = await runSubscriptionEndingReminderJob();
  // 503 while reminders fail to send, so an external scheduler alerts; they are retried next run.
  return Response.json(result, {
    status: healthy ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
