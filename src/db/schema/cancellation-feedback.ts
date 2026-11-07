import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Answers to the optional survey shown when a personal or team subscription is
 * canceled. One row per cancellation; a resumed and re-canceled subscription
 * gets another row. Removed with the user who answered.
 */
export const cancellationFeedback = pgTable(
  "cancellation_feedback",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Set for a team plan; NULL for a personal subscription.
    organizationId: text("organization_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    planId: text("plan_id"),
    // One of CANCELLATION_REASONS in src/lib/cancellation-feedback.ts.
    reason: text("reason"),
    comment: text("comment"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index("cancellation_feedback_created_at_idx").on(table.createdAt),
    userIdx: index("cancellation_feedback_user_idx").on(table.userId),
  }),
);
