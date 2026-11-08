import "@tanstack/react-start/server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobArtifacts } from "@/db/schema";
import { createId } from "../data/ids";
import type { Artifact } from "../types";

function mapArtifact(row: typeof jobArtifacts.$inferSelect): Artifact {
  return {
    id: row.id,
    jobId: row.jobId,
    threadId: row.threadId,
    botId: row.botId,
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
  if (!normalizedPath || normalizedPath.split("/").some((part) => part === ".." || part.startsWith("."))) {
    throw new Error("Artifact path must stay inside the workspace");
  }
  const [row] = await db
    .insert(jobArtifacts)
    .values({
      id: createId("art"),
      userId: options.userId,
      jobId: options.jobId ?? null,
      threadId: options.threadId,
      botId: options.botId ?? null,
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
    .from(jobArtifacts)
    .where(and(eq(jobArtifacts.userId, userId), eq(jobArtifacts.id, id)))
    .limit(1);
  return rows[0] ? mapArtifact(rows[0]) : null;
}

export async function listArtifacts(userId: string, threadId?: string) {
  const conditions = [eq(jobArtifacts.userId, userId)];
  if (threadId) conditions.push(eq(jobArtifacts.threadId, threadId));
  const rows = await db
    .select()
    .from(jobArtifacts)
    .where(and(...conditions))
    .orderBy(desc(jobArtifacts.createdAt))
    .limit(200);
  return rows.map(mapArtifact);
}
