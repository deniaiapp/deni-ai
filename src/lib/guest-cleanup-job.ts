import { and, asc, eq, gt, lt, notExists, sql } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { session, user } from "@/db/schema";

/**
 * A guest is kept this long after creation even without a live session, so one
 * whose session row is still being written is never taken for abandoned.
 */
const GUEST_MIN_AGE_MS = 24 * 60 * 60_000;

/** Guests deleted per run, oldest first; the next run continues. */
const GUEST_CLEANUP_BATCH_SIZE = 200;

export type GuestCleanupJobResult = { deleted: number; failed: number; healthy: boolean };

/**
 * Deletes guest accounts that no session can sign in to any more (signed out,
 * or expired after a week without use), with everything they made: a guest
 * has no other way back in. Deletion goes through Better Auth, so the account
 * deletion hooks remove stored files as well. Safe on several replicas at once:
 * deleting a guest twice changes nothing.
 */
export async function runGuestCleanupJob(now = new Date()): Promise<GuestCleanupJobResult> {
  const abandoned = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.isAnonymous, true),
        lt(user.createdAt, new Date(now.getTime() - GUEST_MIN_AGE_MS)),
        notExists(
          db
            .select({ exists: sql`1` })
            .from(session)
            .where(and(eq(session.userId, user.id), gt(session.expiresAt, now))),
        ),
      ),
    )
    .orderBy(asc(user.createdAt))
    .limit(GUEST_CLEANUP_BATCH_SIZE);
  if (abandoned.length === 0) return { deleted: 0, failed: 0, healthy: true };

  // Loaded on demand: the auth config pulls in every auth plugin.
  const { auth } = await import("@/lib/auth");
  const { internalAdapter } = await auth.$context;
  let deleted = 0;
  let failed = 0;
  for (const { id } of abandoned) {
    try {
      await internalAdapter.deleteUser(id);
      deleted++;
    } catch (error) {
      failed++;
      console.error("[guest-cleanup] Failed to delete an abandoned guest", { id, error });
    }
  }
  return { deleted, failed, healthy: failed === 0 };
}
