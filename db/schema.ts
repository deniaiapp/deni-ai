import type { UIMessage } from "ai";
import { jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { Store } from "@/lib/types";

export const userStores = pgTable("user_stores", {
  userId: text("user_id").primaryKey(),
  data: jsonb("data").$type<Store>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const threadMessages = pgTable(
  "thread_messages",
  {
    userId: text("user_id").notNull(),
    threadId: text("thread_id").notNull(),
    messages: jsonb("messages").$type<UIMessage[]>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.userId, table.threadId] }),
  }),
);
