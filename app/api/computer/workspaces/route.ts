import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { db } from "@/db";
import { browserWorkspaces } from "@/db/schema";
import { getExtracted } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const rows = await db
    .select()
    .from(browserWorkspaces)
    .where(eq(browserWorkspaces.userId, userId))
    .orderBy(desc(browserWorkspaces.updatedAt))
    .limit(100);
  return NextResponse.json({
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

export async function PATCH(req: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json().catch(() => ({}))) as { jobId?: string; takeover?: boolean };
  if (!body.jobId) return NextResponse.json({ error: t("Job ID is required") }, { status: 400 });
  const [row] = await db
    .update(browserWorkspaces)
    .set({
      takeoverJobId: body.takeover ? body.jobId : null,
      status: body.takeover ? "takeover" : "idle",
      updatedAt: new Date(),
    })
    .where(and(eq(browserWorkspaces.userId, userId), eq(browserWorkspaces.jobId, body.jobId)))
    .returning();
  if (!row) return NextResponse.json({ error: t("Workspace not found") }, { status: 404 });
  return NextResponse.json({ workspace: row });
}
