import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq } from "drizzle-orm";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { db } from "@/db";
import { browserWorkspaces } from "@/db/schema";
import { getExtracted } from "@/i18n/server";

async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const rows = await db
    .select()
    .from(browserWorkspaces)
    .where(eq(browserWorkspaces.userId, userId))
    .orderBy(desc(browserWorkspaces.updatedAt))
    .limit(100);
  return Response.json({
    workspaces: rows.map((row) => ({
      id: row.id,
      jobId: row.jobId,
      botId: row.botId,
      pageKey: row.pageKey,
      status: row.status,
      url: row.url,
      title: row.title,
      takeoverJobId: row.takeoverJobId,
      updatedAt: row.updatedAt.toISOString(),
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

async function PATCH({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json().catch(() => ({}))) as { jobId?: string; takeover?: boolean };
  if (!body.jobId) return Response.json({ error: t("Job ID is required") }, { status: 400 });
  const [row] = await db
    .update(browserWorkspaces)
    .set({
      takeoverJobId: body.takeover ? body.jobId : null,
      status: body.takeover ? "takeover" : "idle",
      updatedAt: new Date(),
    })
    .where(and(eq(browserWorkspaces.userId, userId), eq(browserWorkspaces.jobId, body.jobId)))
    .returning();
  if (!row) return Response.json({ error: t("Workspace not found") }, { status: 404 });
  return Response.json({ workspace: row });
}

export const Route = createFileRoute("/api/computer/workspaces")({
  server: { handlers: { GET, PATCH } },
});
