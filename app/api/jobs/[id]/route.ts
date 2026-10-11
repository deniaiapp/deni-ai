import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { getJob, listJobEvents } from "@/lib/jobs";
import { cancelAndReleaseJob, retryAndRunJob } from "@/lib/job-actions";
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
    const job = await cancelAndReleaseJob(userId, id, await getLocale());
    if (!job) return NextResponse.json({ error: t("This job cannot be cancelled") }, { status: 409 });
    return NextResponse.json({ job });
  }
  if (body.action === "retry") {
    const retried = await retryAndRunJob(userId, id, { reviewed: body.reviewed === true });
    if (!retried.ok && retried.reason === "not_found") return NextResponse.json({ error: t("Job not found") }, { status: 404 });
    if (!retried.ok) {
      return NextResponse.json({ error: t("This job cannot be retried"), job: retried.job }, { status: 409 });
    }
    return NextResponse.json({ job: retried.job }, { status: 202 });
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
