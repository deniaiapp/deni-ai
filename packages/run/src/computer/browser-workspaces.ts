import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "../runtime";
import { runBrowserWorkspaces } from "@deniai/db";

export async function claimBrowserTakeover(userId: string, jobId: string) {
  const rows = await db
    .update(runBrowserWorkspaces)
    .set({ takeoverJobId: jobId, status: "takeover", updatedAt: new Date() })
    .where(
      and(
        eq(runBrowserWorkspaces.userId, userId),
        eq(runBrowserWorkspaces.jobId, jobId),
        or(
          isNull(runBrowserWorkspaces.takeoverJobId),
          eq(runBrowserWorkspaces.takeoverJobId, jobId),
        ),
      ),
    )
    .returning({ id: runBrowserWorkspaces.id });
  return rows.length > 0;
}

export async function releaseBrowserTakeover(userId: string, jobId: string) {
  await db
    .update(runBrowserWorkspaces)
    .set({ takeoverJobId: null, status: "idle", updatedAt: new Date() })
    .where(
      and(
        eq(runBrowserWorkspaces.userId, userId),
        eq(runBrowserWorkspaces.jobId, jobId),
        eq(runBrowserWorkspaces.takeoverJobId, jobId),
      ),
    );
}
