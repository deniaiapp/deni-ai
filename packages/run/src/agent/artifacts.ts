import { and, desc, eq } from "drizzle-orm";
import { db } from "../runtime";
import { runArtifacts } from "@deniai/db";
import { createId } from "../data/ids";
import type { Artifact } from "../types";

function mapArtifact(row: typeof runArtifacts.$inferSelect): Artifact {
  return {
    id: row.id,
    jobId: row.jobId,
    threadId: row.threadId,
    botId: row.teammateId,
    path: row.path,
    title: row.title,
    mimeType: row.mimeType,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function registerArtifact(options: {
  userId: string;
  jobId?: string | null;
  threadId: string;
  botId?: string | null;
  path: string;
  title: string;
  mimeType?: string;
  description?: string | null;
}) {
  const normalizedPath = options.path.trim().replace(/^\/+/, "");
  if (
    !normalizedPath ||
    normalizedPath.split("/").some((part) => part === ".." || part.startsWith("."))
  ) {
    throw new Error("Artifact path must stay inside the workspace");
  }
  const [row] = await db
    .insert(runArtifacts)
    .values({
      id: createId("art"),
      userId: options.userId,
      jobId: options.jobId ?? null,
      threadId: options.threadId,
      teammateId: options.botId ?? null,
      path: normalizedPath,
      title: options.title.trim() || normalizedPath,
      mimeType: options.mimeType?.trim() || "text/plain",
      description: options.description?.trim() || null,
    })
    .returning();
  if (!row) throw new Error("Unable to register artifact");
  return mapArtifact(row);
}

export async function getArtifact(userId: string, id: string) {
  const rows = await db
    .select()
    .from(runArtifacts)
    .where(and(eq(runArtifacts.userId, userId), eq(runArtifacts.id, id)))
    .limit(1);
  return rows[0] ? mapArtifact(rows[0]) : null;
}

export async function listArtifacts(userId: string, threadId?: string) {
  const conditions = [eq(runArtifacts.userId, userId)];
  if (threadId) conditions.push(eq(runArtifacts.threadId, threadId));
  const rows = await db
    .select()
    .from(runArtifacts)
    .where(and(...conditions))
    .orderBy(desc(runArtifacts.createdAt))
    .limit(200);
  return rows.map(mapArtifact);
}
