import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/auth/api";
import { listJobOverview, listJobs } from "@/lib/jobs";
import { listNotifications } from "@/lib/jobs/notifications";

async function GET({ request: req }: { request: Request }) {
  const startedAt = performance.now();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const authenticatedAt = performance.now();
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId") || undefined;
  const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
  const withNotifications = url.searchParams.get("notifications") === "1";
  const [jobs, notifications] = await Promise.all([
    url.searchParams.get("overview") === "1"
      ? listJobOverview(userId, Number.isFinite(requestedLimit) ? requestedLimit : 200, true)
      : listJobs(userId, { threadId, limit: Number.isFinite(requestedLimit) ? requestedLimit : 50, summary: true }),
    withNotifications ? listNotifications(userId, { unreadOnly: true }).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const filteredJobs = threadId ? jobs.filter((job) => job.threadId === threadId) : jobs;
  return Response.json({ jobs: filteredJobs, ...(withNotifications ? { notifications } : {}) }, {
    headers: { "Cache-Control": "no-store", "Server-Timing": `auth;dur=${(authenticatedAt - startedAt).toFixed(1)}, data;dur=${(performance.now() - authenticatedAt).toFixed(1)}` },
  });
}

export const Route = createFileRoute("/api/jobs/")({
  server: { handlers: { GET } },
});
