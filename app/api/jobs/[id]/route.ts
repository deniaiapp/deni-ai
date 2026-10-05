import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { cancelJob, getJob, listJobEvents, retryJob } from "@/lib/jobs";
import { releaseBrowserTakeover } from "@/lib/browser-workspaces";
import { setComputer } from "@/lib/computer";
import { runBackgroundJob } from "@/lib/job-runner";
import { getExtracted, getLocale } from "next-intl/server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Context) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = await context.params;
  const job = await getJob(userId, id);
  if (!job) return NextResponse.json({ error: t("Job not found") }, { status: 404 });
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
  return NextResponse.json(
    { job, events: await listJobEvents(userId, id, Number.isFinite(after) ? after : 0) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request, context: Context) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; reviewed?: boolean };
  if (body.action === "cancel") {
    const before = await getJob(userId, id);
    const job = await cancelJob(userId, id, await getLocale());
    if (!job) return NextResponse.json({ error: t("This job cannot be cancelled") }, { status: 409 });
    // A job parked for takeover or approval has no running handler to clean up after it, so
    // release its workspace here; otherwise the computer keeps showing "Your help is needed".
    if (before?.status === "waiting_takeover" || before?.status === "waiting_approval") {
      await releaseBrowserTakeover(userId, id).catch(() => undefined);
      await setComputer(userId, { status: "idle", workingLabel: "", workingBotId: null, jobId: id }).catch(() => undefined);
    }
    return NextResponse.json({ job });
  }
  if (body.action === "retry") {
    const job = await retryJob(userId, id, { reviewed: body.reviewed === true });
    if (!job) return NextResponse.json({ error: t("Job not found") }, { status: 404 });
    if (job.status !== "queued") {
      return NextResponse.json({ error: t("This job cannot be retried"), job }, { status: 409 });
    }
    void runBackgroundJob(userId, job.id).catch((error) => {
      console.error("[jobs] retry failed", error);
    });
    return NextResponse.json({ job }, { status: 202 });
  }
  if (body.action === "resume") {
    const current = await getJob(userId, id);
    if (!current) return NextResponse.json({ error: t("Job not found") }, { status: 404 });
    if (current.status !== "waiting_approval" && current.status !== "waiting_takeover") {
      return NextResponse.json({ job: current }, { status: 409 });
    }
    // Only a chat request carrying new input or an approval response can resume
    // this job. Exposing it as queued here lets the worker replay old input.
    return NextResponse.json({ job: current, resumeVia: "chat" });
  }
  return NextResponse.json({ error: t("Unsupported action") }, { status: 400 });
}
