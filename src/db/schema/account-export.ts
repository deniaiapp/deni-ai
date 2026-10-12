import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Account data exports built in the background (Settings → Account). The JSON
 * file is a private UploadThing file under `storage_key`, uploaded with the
 * row id as its custom id, and only handed out as a short-lived signed URL to
 * its owner. A row is `pending` while its job runs, then `ready` (with
 * `expires_at`, 7 days later) or `failed`. Export files do not count toward
 * the attachment storage quota; the storage-cleanup cron deletes expired ones.
 */
export const accountExport = pgTable(
  "account_export",
  {
    /** Random, unguessable id. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "ready", "failed"] })
      .notNull()
      .default("pending"),
    /** UploadThing file key; null until the file is stored. */
    storageKey: text("storage_key"),
    /** Size of the stored file; null until it is stored. */
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** Short internal reason of a failed export (never shown to the user). */
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** When a ready export's file is deleted. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("account_export_user_created_idx").on(table.userId, table.createdAt),
    index("account_export_status_expires_idx").on(table.status, table.expiresAt),
    index("account_export_status_created_idx").on(table.status, table.createdAt),
  ],
);
