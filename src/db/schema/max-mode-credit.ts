import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

/**
 * One purchase of prepaid Max Mode credits. A personal lot belongs to its user, a
 * team lot to its organization. Usage past the plan's pool spends the lots that
 * expire first; a lot expires 180 days after purchase.
 */
export const maxModeCreditLot = pgTable(
  "max_mode_credit_lot",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id"),
    /** "checkout" (a pack or custom amount) or "auto_top_up". */
    source: text("source").notNull(),
    /** Granted and unspent usage units (1 credit = $1 = 2M units). */
    grantedUnits: bigint("granted_units", { mode: "number" }).notNull(),
    remainingUnits: bigint("remaining_units", { mode: "number" }).notNull(),
    /** Units taken back by a refund or dispute, restored if the dispute is won. */
    revokedUnits: bigint("revoked_units", { mode: "number" }).notNull().default(0),
    amountPaid: integer("amount_paid").notNull(),
    currency: text("currency").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    purchasedByUserId: text("purchased_by_user_id"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("max_mode_credit_lot_payment_intent_idx").on(table.stripePaymentIntentId),
    index("max_mode_credit_lot_user_idx")
      .on(table.userId, table.expiresAt)
      .where(sql`user_id IS NOT NULL`),
    index("max_mode_credit_lot_organization_idx")
      .on(table.organizationId, table.expiresAt)
      .where(sql`organization_id IS NOT NULL`),
    check("max_mode_credit_lot_owner_check", sql`(user_id IS NULL) <> (organization_id IS NULL)`),
    check(
      "max_mode_credit_lot_units_check",
      sql`remaining_units >= 0 AND remaining_units <= granted_units`,
    ),
  ],
);

/** Auto top-up settings of one credit owner (a user or an organization). */
export const maxModeCreditAccount = pgTable(
  "max_mode_credit_account",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id"),
    autoTopUpEnabled: boolean("auto_top_up_enabled").notNull().default(false),
    /** Top up once the balance falls below this many credits. */
    autoTopUpThresholdCredits: integer("auto_top_up_threshold_credits").notNull().default(5),
    autoTopUpAmountCredits: integer("auto_top_up_amount_credits").notNull().default(10),
    /** Card saved at a credit checkout for off-session top-ups. */
    paymentMethodId: text("payment_method_id"),
    lastAutoTopUpAt: timestamp("last_auto_top_up_at"),
    /** Why the last auto top-up failed; auto top-up turns off until it is re-enabled. */
    lastAutoTopUpError: text("last_auto_top_up_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("max_mode_credit_account_user_idx")
      .on(table.userId)
      .where(sql`user_id IS NOT NULL`),
    uniqueIndex("max_mode_credit_account_organization_idx")
      .on(table.organizationId)
      .where(sql`organization_id IS NOT NULL`),
    check(
      "max_mode_credit_account_owner_check",
      sql`(user_id IS NULL) <> (organization_id IS NULL)`,
    ),
  ],
);
