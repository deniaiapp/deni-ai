import { and, eq, notExists, sql } from "drizzle-orm";
import { db as defaultDb } from "@/db/drizzle";
import {
  attachment,
  chats,
  memoryItem,
  modelComparisons,
  projectFiles,
  projects,
  userMemory,
} from "@/db/schema";

/**
 * Moves what a guest made (chats, comparisons, projects and their files,
 * attachments, memories) to the account they signed up for or signed in to,
 * in one transaction, before the guest row and anything left on it are
 * deleted. Usage, ad events, and sessions stay with the guest: the account has
 * its own allowance. An account that already has memory preferences keeps them.
 * Attachments only change owner: their files and storage keys stay as they are.
 */
export async function transferGuestData(
  guestId: string,
  userId: string,
  database: typeof defaultDb = defaultDb,
) {
  await database.transaction(async (tx) => {
    await tx.update(chats).set({ uid: userId }).where(eq(chats.uid, guestId));
    await tx.update(modelComparisons).set({ uid: userId }).where(eq(modelComparisons.uid, guestId));
    await tx.update(projects).set({ userId }).where(eq(projects.userId, guestId));
    await tx.update(projectFiles).set({ userId }).where(eq(projectFiles.userId, guestId));
    await tx.update(attachment).set({ userId }).where(eq(attachment.userId, guestId));
    await tx.update(memoryItem).set({ userId }).where(eq(memoryItem.userId, guestId));
    await tx
      .update(userMemory)
      .set({ userId })
      .where(
        and(
          eq(userMemory.userId, guestId),
          notExists(
            tx
              .select({ exists: sql`1` })
              .from(userMemory)
              .where(eq(userMemory.userId, userId)),
          ),
        ),
      );
  });
}
