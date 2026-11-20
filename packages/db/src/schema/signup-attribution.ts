import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Where a new account came from: the first visit's UTM parameters, referring
 * host and landing path, read from a first-party cookie when the user row is
 * created. One row per account; accounts that arrived with neither (direct
 * visits) have no row. Removed with the user.
 */
export const signupAttribution = pgTable(
  "signup_attribution",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    // Host only (e.g. `t.co` for links on X), never the full referring URL.
    referrerHost: text("referrer_host"),
    landingPath: text("landing_path"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index("signup_attribution_created_at_idx").on(table.createdAt),
  }),
);
