import { sql } from "drizzle-orm";
import { bigint, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

/**
 * Per-product monthly usage totals behind the combined usage view.
 *
 * - `chat` / `flixa`: `metric` is the shared quota category ("basic" | "premium"),
 *   `unit` is "tokens" (or "requests" for guests). The quota itself stays in
 *   `usage_quota`; these rows only say which product spent it.
 * - `run` (Deni Run): `metric` is "model" | "browser" | "computer", `unit` is
 *   "usd_micros". These rows are the Deni Run budget ledger itself.
 *
 * `period_start` is the UTC calendar month, matching the quota reset window.
 * flixa-backend writes the `flixa` rows with raw SQL, so keep the shape stable.
 */
export const productUsage = pgTable(
  "product_usage",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    product: text("product", { enum: ["chat", "flixa", "run"] }).notNull(),
    metric: text("metric").notNull(),
    unit: text("unit").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    used: bigint("used", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("product_usage_user_period_idx").on(
      table.userId,
      table.product,
      table.metric,
      table.unit,
      table.periodStart,
    ),
  ],
);
