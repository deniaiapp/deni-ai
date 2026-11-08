import "@tanstack/react-start/server-only";

import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { browserWorkspaces } from "@/db/schema";

export async function claimBrowserTakeover(userId: string, jobId: string) {
  const rows = await db
    .update(browserWorkspaces)
    .set({ takeoverJobId: jobId, status: "takeover", updatedAt: new Date() })
    .where(
      and(
        eq(browserWorkspaces.userId, userId),
        eq(browserWorkspaces.jobId, jobId),
        or(isNull(browserWorkspaces.takeoverJobId), eq(browserWorkspaces.takeoverJobId, jobId)),
      ),
    )
    .returning({ id: browserWorkspaces.id });
  return rows.length > 0;
}

export async function releaseBrowserTakeover(userId: string, jobId: string) {
  await db
    .update(browserWorkspaces)
    .set({ takeoverJobId: null, status: "idle", updatedAt: new Date() })
    .where(
      and(
        eq(browserWorkspaces.userId, userId),
        eq(browserWorkspaces.jobId, jobId),
        eq(browserWorkspaces.takeoverJobId, jobId),
      ),
    );
}
