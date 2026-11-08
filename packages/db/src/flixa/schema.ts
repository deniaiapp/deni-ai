/**
 * Tables Flixa owns, in the `flixa` Postgres schema of the Deni AI database.
 * Migrations: `pnpm run db:generate:flixa` / `pnpm run db:migrate:flixa` in
 * packages/db (drizzle.flixa.config.ts).
 * Deni AI's drizzle-kit only manages `public`, so it never touches these.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../schema/auth-schema";

export const flixa = pgSchema("flixa");

/** Users banned from Flixa. Deleting the Deni AI account deletes the ban. */
export const ban = flixa.table(
  "ban",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    clientHeaders: jsonb("client_headers").$type<Record<string, string | null> | null>(),
    bannedAt: timestamp("banned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ban_banned_at_idx").on(table.bannedAt.desc())],
);

export const silentBanRule = flixa.table(
  "silent_ban_rule",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    hitsBeforeBan: integer("hits_before_ban").notNull().default(3),
    reason: text("reason").notNull().default("silent_ban_rule"),
    conditions: jsonb("conditions")
      .$type<unknown>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("silent_ban_rule_enabled_idx")
      .on(table.enabled)
      .where(sql`${table.enabled} = TRUE`),
  ],
);

export const silentBanHit = flixa.table(
  "silent_ban_hit",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => silentBanRule.id, { onDelete: "cascade" }),
    hitCount: integer("hit_count").notNull().default(0),
    firstHitAt: timestamp("first_hit_at", { withTimezone: true }).notNull().defaultNow(),
    lastHitAt: timestamp("last_hit_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.ruleId] }),
    index("silent_ban_hit_rule_idx").on(table.ruleId),
  ],
);

/**
 * @deprecated Receipts of the legacy Flixa usage path only
 * (`FLIXA_USAGE_ENGINE=legacy` or `shadow`). With the shared usage engine
 * (`shared`, the default) Flixa reservations live in `public.usage_reservation`
 * (product `flixa`) and nothing writes this table. Kept for rollback; a later
 * flixa migration drops it once no unsettled receipts remain
 * (packages/billing/docs/usage-engine.md).
 *
 * Receipts for quota reserved in Deni AI's `usage_quota` and not yet settled.
 * `period_start` is the quota row's period start as epoch seconds text, so a
 * receipt from an earlier period or tier never adjusts a reset row.
 */
export const usageReservation = flixa.table(
  "usage_reservation",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    planTier: text("plan_tier").notNull(),
    periodStart: text("period_start").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("usage_reservation_amount_check", sql`${table.amount} > 0`)],
);
