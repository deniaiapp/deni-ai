import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { projects } from "./project";

export const chats = pgTable(
  "chats",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    uid: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    activeGenerationId: text("active_generation_id"),
    // Arrival time of the latest stop request, so a request that arrived before
    // it stops itself when it registers its generation on any instance.
    stopRequestedAt: timestamp("stop_requested_at"),
    title: text("title"),
    messages: jsonb("messages").default(sql`'[]'`),
    // Number of `chat_messages` rows when they hold the whole transcript; NULL
    // for chats not backfilled yet (reads fall back to `messages`). Written by
    // apps/web/src/lib/chat-message-rows.ts in the same transaction as `messages`.
    messageCount: integer("message_count"),
    pinned: boolean("pinned").default(false).notNull(),
    folder: text("folder"),
    tags: jsonb("tags")
      .default(sql`'[]'`)
      .notNull(),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("chats_user_id_idx").on(table.uid),
    projectIdIdx: index("chats_project_id_idx").on(table.projectId),
    // Speeds up the sidebar list query (uid filter + updated_at DESC).
    userUpdatedIdx: index("chats_user_updated_idx").on(table.uid, table.updated_at.desc()),
  }),
);

/**
 * One row per chat message, in transcript order (`seq` from 0). Dual-written
 * with `chats.messages`; see apps/web/src/lib/chat-message-rows.ts.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    /** The AI SDK `UIMessage.id`. Not unique: imported transcripts may repeat ids. */
    messageId: text("message_id").notNull(),
    role: text("role").notNull(),
    parts: jsonb("parts").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Also serves the latest-N and page-by-page reads (backward index scan on seq).
    unique("chat_messages_chat_id_seq_unique").on(table.chatId, table.seq),
  ],
);
