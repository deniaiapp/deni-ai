import type { UIMessage } from "ai";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/drizzle";
import {
  billing,
  chats,
  memoryItem,
  modelComparisons,
  projectFiles,
  projects,
  resetCreditBalance,
  securityActivity,
  usageQuota,
  user,
  userMemory,
} from "@/db/schema";
import { appVersion } from "@/lib/version";
import { currentProjectAccessWhere } from "@/lib/project-access";

function textFromMessage(message: UIMessage): string {
  const texts: string[] = [];
  for (const part of message.parts ?? []) {
    if (part.type === "text" && "text" in part && typeof part.text === "string") {
      texts.push(part.text);
    }
  }
  return texts.join("\n");
}

function simplifyMessages(raw: unknown): Array<{ role: string; text: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Array<{ role: string; text: string }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const message = entry as UIMessage;
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = textFromMessage(message).trim();
    if (!text) continue;
    out.push({ role: message.role, text });
  }
  return out;
}

/**
 * Transcripts are read this many rows at a time and reduced to their text right
 * away, so the raw JSONB (tool output, reasoning, files) of only one page is in
 * memory at once.
 */
export const EXPORT_TRANSCRIPT_PAGE_SIZE = 100;

async function collectPages<Row extends { id: string }, Item>(
  loadPage: (afterId: string | undefined) => Promise<Row[]>,
  toItem: (row: Row) => Item,
): Promise<Item[]> {
  const items: Item[] = [];
  let afterId: string | undefined;
  for (;;) {
    const rows = await loadPage(afterId);
    for (const row of rows) items.push(toItem(row));
    if (rows.length < EXPORT_TRANSCRIPT_PAGE_SIZE) return items;
    afterId = rows[rows.length - 1].id;
  }
}

export async function buildAccountExport(userId: string) {
  const [
    profileRow,
    memoryProfile,
    memories,
    projectRows,
    fileRows,
    chatItems,
    comparisonItems,
    usageRows,
    billingRow,
    resetCreditRow,
    activityRows,
  ] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        twoFactorEnabled: user.twoFactorEnabled,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(userMemory)
      .where(eq(userMemory.userId, userId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db.select().from(memoryItem).where(eq(memoryItem.userId, userId)),
    db
      .select()
      .from(projects)
      .where(and(eq(projects.userId, userId), currentProjectAccessWhere(userId))),
    db.select().from(projectFiles).where(eq(projectFiles.userId, userId)),
    collectPages(
      (afterId) =>
        db
          .select({
            id: chats.id,
            title: chats.title,
            projectId: chats.projectId,
            pinned: chats.pinned,
            folder: chats.folder,
            tags: chats.tags,
            createdAt: chats.created_at,
            updatedAt: chats.updated_at,
            messages: chats.messages,
          })
          .from(chats)
          .where(and(eq(chats.uid, userId), afterId ? gt(chats.id, afterId) : undefined))
          .orderBy(chats.id)
          .limit(EXPORT_TRANSCRIPT_PAGE_SIZE),
      (chat) => ({ ...chat, messages: simplifyMessages(chat.messages) }),
    ),
    collectPages(
      (afterId) =>
        db
          .select({
            id: modelComparisons.id,
            title: modelComparisons.title,
            leftModel: modelComparisons.leftModel,
            rightModel: modelComparisons.rightModel,
            leftName: modelComparisons.leftName,
            rightName: modelComparisons.rightName,
            createdAt: modelComparisons.createdAt,
            updatedAt: modelComparisons.updatedAt,
            leftMessages: modelComparisons.leftMessages,
            rightMessages: modelComparisons.rightMessages,
          })
          .from(modelComparisons)
          .where(
            and(
              eq(modelComparisons.uid, userId),
              afterId ? gt(modelComparisons.id, afterId) : undefined,
            ),
          )
          .orderBy(modelComparisons.id)
          .limit(EXPORT_TRANSCRIPT_PAGE_SIZE),
      (comparison) => ({
        ...comparison,
        leftMessages: simplifyMessages(comparison.leftMessages),
        rightMessages: simplifyMessages(comparison.rightMessages),
      }),
    ),
    db.select().from(usageQuota).where(eq(usageQuota.userId, userId)),
    db
      .select({
        planId: billing.planId,
        status: billing.status,
        currentPeriodEnd: billing.currentPeriodEnd,
        maxModeEnabled: billing.maxModeEnabled,
        createdAt: billing.createdAt,
      })
      .from(billing)
      .where(and(eq(billing.userId, userId), isNull(billing.organizationId)))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        credits: resetCreditBalance.credits,
        updatedAt: resetCreditBalance.updatedAt,
      })
      .from(resetCreditBalance)
      .where(eq(resetCreditBalance.userId, userId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        action: securityActivity.action,
        ipAddress: securityActivity.ipAddress,
        userAgent: securityActivity.userAgent,
        createdAt: securityActivity.createdAt,
      })
      .from(securityActivity)
      .where(eq(securityActivity.userId, userId))
      .orderBy(desc(securityActivity.createdAt))
      .limit(200),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    appVersion,
    profile: profileRow,
    personalization: memoryProfile
      ? {
          instructions: memoryProfile.instructions,
          tone: memoryProfile.tone,
          friendliness: memoryProfile.friendliness,
          warmth: memoryProfile.warmth,
          emojiStyle: memoryProfile.emojiStyle,
          autoMemory: memoryProfile.autoMemory,
        }
      : null,
    memories: memories.map((item) => ({
      content: item.content,
      source: item.source,
      createdAt: item.createdAt,
    })),
    projects: projectRows.map((project) => {
      const files: Array<{
        filename: string;
        url: string;
        size: number;
        mimeType: string;
        createdAt: Date;
      }> = [];
      for (const file of fileRows) {
        if (file.projectId !== project.id) continue;
        files.push({
          filename: file.filename,
          url: file.url,
          size: file.size,
          mimeType: file.mimeType,
          createdAt: file.createdAt,
        });
      }
      return {
        id: project.id,
        name: project.name,
        description: project.description,
        instructions: project.instructions,
        color: project.color,
        defaultModel: project.defaultModel,
        organizationId: project.organizationId,
        archivedAt: project.archivedAt,
        createdAt: project.createdAt,
        files,
      };
    }),
    chats: chatItems,
    comparisons: comparisonItems,
    usage: usageRows.map((row) => ({
      category: row.category,
      planTier: row.planTier,
      limitAmount: row.limitAmount,
      unit: row.unit,
      used: row.used,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
    })),
    billing: billingRow,
    resetCredits: resetCreditRow,
    securityActivity: activityRows,
  };
}
