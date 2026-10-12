import { bigint, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { chats } from "./chat";

/**
 * Private chat attachments. Files live in UploadThing under `storage_key` and
 * are only reachable through `/api/attachments/<id>`, which checks the owner.
 * A row is inserted as `pending` (reserving its size against the owner's
 * storage quota) before the upload and becomes `ready` once the file is stored.
 * A row marked `deleting` no longer counts against the quota and only waits
 * for its stored file to be deleted; the row goes once that succeeds, and the
 * storage-cleanup cron retries any left behind.
 */
export const attachment = pgTable(
  "attachment",
  {
    /** Random, unguessable id used in the app URL. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chats.id, { onDelete: "set null" }),
    /** UploadThing file key; null until the upload succeeds. */
    storageKey: text("storage_key"),
    mediaType: text("media_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    status: text("status", { enum: ["pending", "ready", "deleting"] })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("attachment_user_id_idx").on(table.userId),
    index("attachment_chat_id_idx").on(table.chatId),
    index("attachment_status_created_idx").on(table.status, table.createdAt),
    // NULLs are distinct, so pending rows without a key never collide.
    uniqueIndex("attachment_storage_key_idx").on(table.storageKey),
  ],
);
