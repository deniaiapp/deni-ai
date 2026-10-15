import "@tanstack/react-start/server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { appNotifications } from "@/db/schema";
import { pushNotificationToDiscord } from "./discord-push";
import { createId } from "./ids";
import type { AppNotification, NotificationKind } from "./types";

function mapNotification(row: typeof appNotifications.$inferSelect): AppNotification {
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
    .insert(appNotifications)
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
  // Background results also reach the linked Discord account. Nobody waits for Discord, and
  // the push never throws, so a slow or failing Discord cannot hold up or break the caller.
  if (notification) void pushNotificationToDiscord(options.userId, notification);
  return notification;
}

export async function listNotifications(userId: string, options?: { unreadOnly?: boolean; limit?: number }) {
  const conditions = [eq(appNotifications.userId, userId)];
  if (options?.unreadOnly) conditions.push(isNull(appNotifications.readAt));
  const rows = await db
    .select()
    .from(appNotifications)
    .where(and(...conditions))
    .orderBy(desc(appNotifications.createdAt))
    .limit(Math.min(Math.max(options?.limit ?? 50, 1), 200));
  return rows.map(mapNotification);
}

export async function markNotificationRead(userId: string, id: string, read = true) {
  const [row] = await db
    .update(appNotifications)
    .set({ readAt: read ? new Date() : null })
    .where(and(eq(appNotifications.userId, userId), eq(appNotifications.id, id)))
    .returning();
  return row ? mapNotification(row) : null;
}

export async function markAllNotificationsRead(userId: string) {
  await db
    .update(appNotifications)
    .set({ readAt: new Date() })
    .where(and(eq(appNotifications.userId, userId), isNull(appNotifications.readAt)));
}
