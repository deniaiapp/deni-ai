import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../runtime";
import { runNotifications } from "@deniai/db";
import { runDeps, runLogger } from "../runtime";
import { createId } from "../data/ids";
import type { AppNotification, NotificationKind } from "../types";

function mapNotification(row: typeof runNotifications.$inferSelect): AppNotification {
  return {
    id: row.id,
    jobId: row.jobId,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createNotification(options: {
  userId: string;
  jobId?: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
}) {
  const [row] = await db
    .insert(runNotifications)
    .values({
      id: createId("ntf"),
      userId: options.userId,
      jobId: options.jobId ?? null,
      kind: options.kind,
      title: options.title,
      body: options.body,
      readAt: null,
    })
    .returning();
  const notification = row ? mapNotification(row) : null;
  // Background results also reach the linked Discord account (the worker registers
  // `onNotification`). Nobody waits for it, and a failure never reaches the caller.
  const hook = runDeps().onNotification;
  if (notification && hook) {
    void Promise.resolve()
      .then(() => hook({ userId: options.userId, ...notification }))
      .catch((error) => runLogger().error("[run] notification hook", error));
  }
  return notification;
}

export async function listNotifications(
  userId: string,
  options?: { unreadOnly?: boolean; limit?: number },
) {
  const conditions = [eq(runNotifications.userId, userId)];
  if (options?.unreadOnly) conditions.push(isNull(runNotifications.readAt));
  const rows = await db
    .select()
    .from(runNotifications)
    .where(and(...conditions))
    .orderBy(desc(runNotifications.createdAt))
    .limit(Math.min(Math.max(options?.limit ?? 50, 1), 200));
  return rows.map(mapNotification);
}

export async function markNotificationRead(userId: string, id: string, read = true) {
  const [row] = await db
    .update(runNotifications)
    .set({ readAt: read ? new Date() : null })
    .where(and(eq(runNotifications.userId, userId), eq(runNotifications.id, id)))
    .returning();
  return row ? mapNotification(row) : null;
}

export async function markAllNotificationsRead(userId: string) {
  await db
    .update(runNotifications)
    .set({ readAt: new Date() })
    .where(and(eq(runNotifications.userId, userId), isNull(runNotifications.readAt)));
}
