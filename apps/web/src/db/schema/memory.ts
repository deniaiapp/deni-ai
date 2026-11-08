import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "@/db/schema";

export const userMemory = pgTable("user_memory", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  instructions: text("instructions").notNull().default(""),
  tone: text("tone").notNull().default("balanced"),
  friendliness: text("friendliness").notNull().default("friendly"),
  warmth: text("warmth").notNull().default("warm"),
  emojiStyle: text("emoji_style").notNull().default("light"),
  autoMemory: boolean("auto_memory").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const memoryItem = pgTable(
  "memory_item",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdIdx: index("memory_item_user_id_idx").on(table.userId),
  }),
);
