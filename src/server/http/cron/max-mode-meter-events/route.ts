import { timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { runUsageAndMeterJob } from "@/lib/usage-and-meter-job";

/**
 * Manual or external trigger of the usage recovery and Max Mode meter job that
 * a production server already runs in-process when work is due (see SETUP.md).
 */
export async function GET(request: Request) {
  if (!env.CRON_SECRET)
    return Response.json({ error: "Usage recovery is disabled" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return new Response(null, { status: 401 });
  }
  const { healthy, ...result } = await runUsageAndMeterJob();
  return Response.json(result, {
    status: healthy ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
