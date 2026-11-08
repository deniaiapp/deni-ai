import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

/**
 * Private beta allowlist. Admins grant access by email, before the account may
 * exist; `user_id` is linked the first time a signed-in user with that verified
 * email is checked. Only read when the web app runs with `BETA_ACCESS_REQUIRED`.
 */
export const betaAccess = pgTable(
  "beta_access",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Lower-cased and trimmed by the app; the check keeps manual inserts consistent. */
    email: text("email").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("beta_access_email_unique").on(table.email),
    index("beta_access_user_id_idx").on(table.userId),
    check("beta_access_email_lowercase_check", sql`${table.email} = lower(trim(${table.email}))`),
  ],
);

export type BetaAccess = typeof betaAccess.$inferSelect;
