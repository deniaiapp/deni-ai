import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "@/db/schema";
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
