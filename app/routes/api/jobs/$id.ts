import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { getJob, listJobEvents } from "@/lib/jobs";
import { cancelAndReleaseJob, retryAndRunJob } from "@/lib/job-actions";
import { getExtracted, getLocale } from "@/i18n/server";

async function GET({ request: req, params }: { request: Request; params: { id: string } }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = params;
  const job = await getJob(userId, id);
  if (!job) return Response.json({ error: t("Job not found") }, { status: 404 });
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
  return Response.json(
    { job, events: await listJobEvents(userId, id, Number.isFinite(after) ? after : 0) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function POST({ request: req, params }: { request: Request; params: { id: string } }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; reviewed?: boolean };
  if (body.action === "cancel") {
    const job = await cancelAndReleaseJob(userId, id, await getLocale());
    if (!job) return Response.json({ error: t("This job cannot be cancelled") }, { status: 409 });
    return Response.json({ job });
  }
  if (body.action === "retry") {
    const retried = await retryAndRunJob(userId, id, { reviewed: body.reviewed === true });
    if (!retried.ok && retried.reason === "not_found") return Response.json({ error: t("Job not found") }, { status: 404 });
    if (!retried.ok) {
      return Response.json({ error: t("This job cannot be retried"), job: retried.job }, { status: 409 });
    }
    return Response.json({ job: retried.job }, { status: 202 });
  }
  if (body.action === "resume") {
    const current = await getJob(userId, id);
    if (!current) return Response.json({ error: t("Job not found") }, { status: 404 });
    if (current.status !== "waiting_approval" && current.status !== "waiting_takeover") {
      return Response.json({ job: current }, { status: 409 });
    }
    // Only a chat request carrying new input or an approval response can resume
    // this job. Exposing it as queued here lets the worker replay old input.
    return Response.json({ job: current, resumeVia: "chat" });
  }
  return Response.json({ error: t("Unsupported action") }, { status: 400 });
}

export const Route = createFileRoute("/api/jobs/$id")({
  server: { handlers: { GET, POST } },
});
