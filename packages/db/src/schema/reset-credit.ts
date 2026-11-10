import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

/**
 * Undated reset credit counts, the v7 format (v7 still grants and spends them on
 * the shared database). v8 moves a user's count into `reset_credit` rows, each
 * valid for a month from the move, and sets it to 0 the first time it reads it.
 */
export const resetCreditBalance = pgTable("reset_credit_balance", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  credits: integer("credits").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/**
 * One usage reset a user can spend to clear their own quota immediately, until
 * `expires_at`. Spent credits keep their row with `used_at` set.
 */
export const resetCredit = pgTable(
  "reset_credit",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("reset_credit_user_id_expires_at_idx").on(table.userId, table.expiresAt)],
);
