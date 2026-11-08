import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

export const billing = pgTable(
  "billing",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Personal rows always name their user: every write passes one, and account
    // deletion deletes them before the user row. A team row belongs to its
    // organization; this is only its billing contact, and it is cleared when
    // that member leaves the team or deletes their account.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    organizationId: text("organization_id"),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    planId: text("plan_id"),
    priceId: text("price_id"),
    status: text("status").default("inactive"),
    cancelAt: integer("cancel_at"),
    mode: text("mode").default("subscription"),
    currentPeriodEnd: timestamp("current_period_end"),
    checkoutSessionId: text("checkout_session_id"),
    flashOfferEndsAt: timestamp("flash_offer_ends_at"),
    firstPaidAt: timestamp("first_paid_at"),
    paymentMethodFingerprint: text("payment_method_fingerprint"),
    // Card funding type from Stripe: "credit" | "debit" | "prepaid" | "unknown"
    cardFunding: text("card_funding"),
    // When the user verified a card via SetupIntent (free-tier boost)
    cardVerifiedAt: timestamp("card_verified_at"),
    // When the user removed their verified card. The fingerprint stays so the
    // card's reuse slot is not freed; a new verification or paid card clears it.
    cardRemovedAt: timestamp("card_removed_at"),
    // One-time 48h flash offer granted for verifying a card; survives card removal.
    cardOfferGrantedAt: timestamp("card_offer_granted_at"),
    deletionPending: boolean("deletion_pending").notNull().default(false),
    trialPaymentMethodFingerprint: text("trial_payment_method_fingerprint"),
    trialUsedAt: timestamp("trial_used_at"),
    // Max Mode: spend prepaid credits (max-mode-credit.ts) once the plan's pool is used up.
    maxModeEnabled: boolean("max_mode_enabled").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => ({
    // Personal billing: one record per user where organizationId is NULL
    userPersonalIdx: uniqueIndex("billing_user_personal_idx")
      .on(table.userId)
      .where(sql`organization_id IS NULL`),
    // Team billing: one record per (user, org) pair. A contactless team row
    // (user_id NULL) is never matched here; team rows are looked up by
    // organization and serialized by the team billing lock instead.
    userOrgIdx: uniqueIndex("billing_user_org_idx")
      .on(table.userId, table.organizationId)
      .where(sql`organization_id IS NOT NULL`),
    // The canonical team row lookup (oldest row per organization).
    organizationIdx: index("billing_organization_idx")
      .on(table.organizationId, table.createdAt, table.id)
      .where(sql`organization_id IS NOT NULL`),
    customerIdx: index("billing_customer_idx").on(table.stripeCustomerId),
    subscriptionIdx: index("billing_subscription_idx").on(table.stripeSubscriptionId),
    paymentMethodFingerprintIdx: index("billing_payment_method_fingerprint_idx").on(
      table.paymentMethodFingerprint,
    ),
    trialPaymentMethodFingerprintIdx: index("billing_trial_payment_method_fingerprint_idx").on(
      table.trialPaymentMethodFingerprint,
    ),
    // No CHECK that personal rows keep their user: a deployment still running
    // code from before this schema relies on the old cascade and deletes the
    // user without removing the personal row first. SET NULL then only leaves
    // that row orphaned (never matched by a user id), where a CHECK would fail
    // the deletion after better-auth already removed the sessions and accounts.
  }),
);
