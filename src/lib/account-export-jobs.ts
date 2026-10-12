import { and, asc, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db/drizzle";
import { accountExport } from "@/db/schema";
import type { AccountStoredFiles } from "@/lib/attachments";
import { buildAccountExport } from "@/lib/account-export";
import { deleteStoredFiles, uploadPrivateFile } from "@/lib/upload";

/**
 * Background account exports (Settings → Account), used when attachment
 * storage is configured: a request creates a `pending` row and schedules
 * `runAccountExportJob`, which stores the JSON as a private file. Only its
 * owner can get a short-lived signed URL to it, until it expires.
 */

type ExportDatabase = Pick<typeof db, "select" | "insert" | "update" | "delete" | "transaction">;

/** A ready export's file is kept this long, then deleted by the storage-cleanup cron. */
export const ACCOUNT_EXPORT_RETENTION_MS = 7 * 24 * 60 * 60_000;

/**
 * A job runs once, right after the request that started it. A row still
 * pending after this long lost its job (restart, crash, host time limit): it
 * reads as failed, and the next request marks it failed and starts a new one.
 */
export const ACCOUNT_EXPORT_STALE_MS = 30 * 60_000;

/** Rows of each kind (expired, unfinished) the storage-cleanup cron deletes per run. */
export const ACCOUNT_EXPORT_CLEANUP_BATCH_SIZE = 500;

/** Rows deleted per statement once their files are gone. */
const ROW_DELETE_BATCH_SIZE = 500;

/** `expired`: ready, but past `expiresAt` (its file is deleted by the next cleanup). */
export type AccountExportState = "pending" | "ready" | "failed" | "expired";

/** What the owner sees of an export: never its storage key. */
export type AccountExportStatus = {
  id: string;
  status: AccountExportState;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
  sizeBytes: number | null;
};

const statusColumns = {
  id: accountExport.id,
  status: accountExport.status,
  createdAt: accountExport.createdAt,
  completedAt: accountExport.completedAt,
  expiresAt: accountExport.expiresAt,
  sizeBytes: accountExport.sizeBytes,
};

type StatusRow = Omit<AccountExportStatus, "status"> & {
  status: (typeof accountExport.$inferSelect)["status"];
};

const fileColumns = { id: accountExport.id, storageKey: accountExport.storageKey };

/** An export row whose file is to be deleted: by key, or by custom id (the row id) without one. */
type ExportFile = { id: string; storageKey: string | null };

/** 32 URL-safe characters: 192 random bits. */
export function newAccountExportId(): string {
  return nanoid(32);
}

/** `deni-ai-export-YYYY-MM-DD.json`, by the UTC date. */
export function accountExportFileName(date: Date): string {
  return `deni-ai-export-${date.toISOString().slice(0, 10)}.json`;
}

export function toAccountExportStatus(row: StatusRow, now: Date = new Date()): AccountExportStatus {
  let status: AccountExportState = row.status;
  if (
    row.status === "pending" &&
    now.getTime() - row.createdAt.getTime() > ACCOUNT_EXPORT_STALE_MS
  ) {
    status = "failed";
  } else if (row.status === "ready" && (!row.expiresAt || row.expiresAt <= now)) {
    status = "expired";
  }
  return { ...row, status };
}

/**
 * Start an export, or return the one still being built. The per-user advisory
 * lock serializes concurrent requests, so at most one job runs per user. A
 * pending row older than `ACCOUNT_EXPORT_STALE_MS` is marked failed first: its
 * job is gone, and the mark keeps it from turning ready if it ever finishes.
 */
export async function startAccountExport(
  userId: string,
  { now = new Date() }: { now?: Date } = {},
  database: ExportDatabase = db,
): Promise<{ export: AccountExportStatus; created: boolean }> {
  const { row, created } = await database.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`account-export:${userId}`}, 0))`,
    );
    await tx
      .update(accountExport)
      .set({ status: "failed", error: "interrupted", completedAt: now })
      .where(
        and(
          eq(accountExport.userId, userId),
          eq(accountExport.status, "pending"),
          lt(accountExport.createdAt, new Date(now.getTime() - ACCOUNT_EXPORT_STALE_MS)),
        ),
      );
    const [running] = await tx
      .select(statusColumns)
      .from(accountExport)
      .where(and(eq(accountExport.userId, userId), eq(accountExport.status, "pending")))
      .orderBy(desc(accountExport.createdAt))
      .limit(1);
    if (running) return { row: running, created: false };
    const [inserted] = await tx
      .insert(accountExport)
      .values({ id: newAccountExportId(), userId, status: "pending", createdAt: now })
      .returning(statusColumns);
    return { row: inserted, created: true };
  });
  return { export: toAccountExportStatus(row, now), created };
}

/** The user's most recent export, or `null` when there is none. */
export async function getLatestAccountExport(
  userId: string,
  { now = new Date() }: { now?: Date } = {},
  database: Pick<typeof db, "select"> = db,
): Promise<AccountExportStatus | null> {
  const [row] = await database
    .select(statusColumns)
    .from(accountExport)
    .where(eq(accountExport.userId, userId))
    .orderBy(desc(accountExport.createdAt))
    .limit(1);
  return row ? toAccountExportStatus(row, now) : null;
}

/**
 * Storage key of an export the user can download: their own, ready and not
 * expired. `null` otherwise, so someone else's id reads like a missing one.
 */
export async function findDownloadableAccountExportKey(
  id: string,
  userId: string,
  { now = new Date() }: { now?: Date } = {},
  database: Pick<typeof db, "select"> = db,
): Promise<string | null> {
  const [row] = await database
    .select({ storageKey: accountExport.storageKey })
    .from(accountExport)
    .where(
      and(
        eq(accountExport.id, id),
        eq(accountExport.userId, userId),
        eq(accountExport.status, "ready"),
        gt(accountExport.expiresAt, now),
      ),
    )
    .limit(1);
  return row?.storageKey ?? null;
}

/**
 * Delete the files of export rows, then the rows whose file is gone. Never
 * throws: a row whose file (or row) could not be deleted stays for the next
 * storage cleanup. `failed` counts the rows left behind.
 */
export async function purgeAccountExports(
  rows: readonly ExportFile[],
  database: Pick<typeof db, "delete"> = db,
): Promise<{ deleted: number; failed: number }> {
  if (rows.length === 0) return { deleted: 0, failed: 0 };
  const keys = rows.flatMap(({ storageKey }) => (storageKey ? [storageKey] : []));
  // Without a key, a job cut off between its upload and saving the key may
  // still have left a file under the row id.
  const customIds = rows.flatMap(({ id, storageKey }) => (storageKey ? [] : [id]));
  const goneKeys = new Set(keys.length > 0 ? await deleteStoredFiles(keys) : []);
  const goneIds = new Set(
    customIds.length > 0 ? await deleteStoredFiles(customIds, "customId") : [],
  );
  const removable = rows.flatMap(({ id, storageKey }) =>
    (storageKey ? goneKeys.has(storageKey) : goneIds.has(id)) ? [id] : [],
  );

  let deleted = 0;
  for (let start = 0; start < removable.length; start += ROW_DELETE_BATCH_SIZE) {
    const ids = removable.slice(start, start + ROW_DELETE_BATCH_SIZE);
    try {
      await database.delete(accountExport).where(inArray(accountExport.id, ids));
      deleted += ids.length;
    } catch (error) {
      console.error("[account-export] Failed to delete export rows after their files", error);
    }
  }
  return { deleted, failed: rows.length - deleted };
}

/**
 * The export part of a storage-cleanup run (`/api/cron/storage-cleanup`):
 * deletes the files and rows of at most `limit` expired exports and `limit`
 * failed or abandoned ones older than the retention, oldest first.
 */
export async function cleanUpAccountExports(
  {
    now = new Date(),
    limit = ACCOUNT_EXPORT_CLEANUP_BATCH_SIZE,
  }: {
    now?: Date;
    limit?: number;
  } = {},
  database: Pick<typeof db, "select" | "delete"> = db,
): Promise<{ deleted: number; failed: number }> {
  const expired = await database
    .select(fileColumns)
    .from(accountExport)
    .where(and(eq(accountExport.status, "ready"), lt(accountExport.expiresAt, now)))
    .orderBy(asc(accountExport.expiresAt))
    .limit(limit);
  const unfinished = await database
    .select(fileColumns)
    .from(accountExport)
    .where(
      and(
        inArray(accountExport.status, ["pending", "failed"]),
        lt(accountExport.createdAt, new Date(now.getTime() - ACCOUNT_EXPORT_RETENTION_MS)),
      ),
    )
    .orderBy(asc(accountExport.createdAt))
    .limit(limit);
  return purgeAccountExports([...expired, ...unfinished], database);
}

/**
 * Export files of an account, read before its user row is deleted (that
 * cascades the rows recording them). See `collectAccountStoredFiles`.
 */
export async function collectAccountExportFiles(
  userId: string,
  database: Pick<typeof db, "select"> = db,
): Promise<AccountStoredFiles> {
  const rows = await database
    .select(fileColumns)
    .from(accountExport)
    .where(eq(accountExport.userId, userId));
  return {
    keys: rows.flatMap(({ storageKey }) => (storageKey ? [storageKey] : [])),
    customIds: rows.flatMap(({ id, storageKey }) => (storageKey ? [] : [id])),
  };
}

/**
 * Whether export `id` may be ready with `storageKey` as its file, so a job must
 * keep that file. Assumed so when the row cannot be read: a file kept for a
 * row that is not ready has no key on it, and is deleted by its custom id with
 * that row (see `purgeAccountExports`).
 */
async function mayBeSavedExportFile(
  id: string,
  storageKey: string,
  database: Pick<typeof db, "select">,
): Promise<boolean> {
  try {
    const [row] = await database
      .select({ status: accountExport.status, storageKey: accountExport.storageKey })
      .from(accountExport)
      .where(eq(accountExport.id, id))
      .limit(1);
    return row?.status === "ready" && row.storageKey === storageKey;
  } catch (error) {
    console.error(`[account-export] Failed to read export ${id} after its job failed:`, error);
    return true;
  }
}

/**
 * Build an export, store it as a private JSON file and mark its row ready for
 * `ACCOUNT_EXPORT_RETENTION_MS`. Scheduled with `after()` by the request that
 * created the row. Never throws: a failure marks the row failed with a short
 * reason (the details are logged) and deletes a file already stored, unless
 * the row may have been saved ready with it after all.
 */
export async function runAccountExportJob(
  { id, userId, createdAt }: { id: string; userId: string; createdAt: Date },
  database: Pick<typeof db, "select" | "update" | "delete"> = db,
): Promise<void> {
  let stage = "build_failed";
  let storageKey: string | null = null;
  try {
    const payload = await buildAccountExport(userId);
    const file = new File([JSON.stringify(payload, null, 2)], accountExportFileName(createdAt), {
      type: "application/json",
    });
    stage = "upload_failed";
    // Downloaded rather than shown when its signed URL is opened. Exports are
    // not attachments: they do not count toward the storage quota.
    storageKey = await uploadPrivateFile(file, id, { contentDisposition: "attachment" });
    if (!storageKey) throw new Error("The export file could not be stored");
    stage = "save_failed";
    const completedAt = new Date();
    const saved = await database
      .update(accountExport)
      .set({
        status: "ready",
        storageKey,
        sizeBytes: file.size,
        error: null,
        completedAt,
        expiresAt: new Date(completedAt.getTime() + ACCOUNT_EXPORT_RETENTION_MS),
      })
      .where(and(eq(accountExport.id, id), eq(accountExport.status, "pending")))
      .returning({ id: accountExport.id });
    if (saved.length === 0) {
      // Marked failed as stale, or deleted with its account, while the job
      // ran: nothing would record the file.
      await deleteStoredFiles([storageKey]);
      return;
    }
  } catch (error) {
    console.error(`[account-export] Export ${id} failed (${stage}):`, error);
    let marked = false;
    try {
      const failed = await database
        .update(accountExport)
        .set({ status: "failed", error: stage, completedAt: new Date() })
        .where(and(eq(accountExport.id, id), eq(accountExport.status, "pending")))
        .returning({ id: accountExport.id });
      marked = failed.length > 0;
    } catch (markError) {
      console.error(`[account-export] Failed to mark export ${id} failed:`, markError);
    }
    // Saving the key can fail after Postgres committed it (a dropped
    // connection): the file is then the row's ready export and stays.
    if (storageKey && (marked || !(await mayBeSavedExportFile(id, storageKey, database)))) {
      await deleteStoredFiles([storageKey]);
    }
    return;
  }

  // The newest export replaces the owner's older ones, so repeated requests
  // keep at most one stored file per user (plus one being built).
  try {
    const older = await database
      .select(fileColumns)
      .from(accountExport)
      .where(
        and(
          eq(accountExport.userId, userId),
          ne(accountExport.id, id),
          ne(accountExport.status, "pending"),
          lt(accountExport.createdAt, createdAt),
        ),
      );
    await purgeAccountExports(older, database);
  } catch (error) {
    console.error("[account-export] Failed to delete older exports", error);
  }
}
