import { and, asc, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/drizzle";
import { env } from "@/env";
import { billing, maxModeCreditAccount, maxModeCreditLot, usageReservation } from "@/db/schema";
import { isBillingDisabled } from "@/lib/billing-config";
import { usageMonthStart } from "@/lib/product-usage-ledger";
import { stripe } from "@/lib/stripe";
import { checkoutCardPaymentMethodOptions } from "@/lib/stripe-checkout";
import { usageUnitsToUsd, usdToUsageUnits } from "@/lib/usage-pool";

/** One credit buys $1 of the plan pool (2M usage units). */
export const MAX_MODE_CREDIT_UNITS = usdToUsageUnits(1);
/** Credits are priced in US dollars; Stripe's adaptive pricing shows local currencies. */
export const MAX_MODE_CREDIT_CURRENCY = "usd";
export const MAX_MODE_CREDIT_PACKS = [5, 10, 25, 50] as const;
export const MAX_MODE_CREDIT_MIN = 5;
export const MAX_MODE_CREDIT_MAX = 500;
/** Unused credits expire 180 days after purchase (within six months of issue). */
export const MAX_MODE_CREDIT_VALIDITY_DAYS = 180;
export const MAX_MODE_AUTO_TOP_UP_THRESHOLD_MIN = 1;
export const MAX_MODE_AUTO_TOP_UP_THRESHOLD_MAX = 100;
/** Stripe metadata purpose of credit checkouts and off-session top-ups. */
export const MAX_MODE_CREDIT_PURPOSE = "max_mode_credits";

const DAY_MS = 24 * 60 * 60 * 1000;
// A failing or concurrent top-up is not retried faster than this.
const AUTO_TOP_UP_MIN_INTERVAL_MS = 60_000;

type CreditDatabase = Pick<typeof db, "select" | "update">;

/** Credits belong to a user (personal plans) or an organization (team plans). */
export type MaxModeCreditOwner =
  | { userId: string; organizationId: null }
  | { userId: null; organizationId: string };

export function creditOwnerFor(record: {
  userId: string | null;
  organizationId: string | null;
}): MaxModeCreditOwner | null {
  if (record.organizationId) return { userId: null, organizationId: record.organizationId };
  return record.userId ? { userId: record.userId, organizationId: null } : null;
}

function lotOwnerCondition(owner: MaxModeCreditOwner) {
  return owner.organizationId
    ? eq(maxModeCreditLot.organizationId, owner.organizationId)
    : eq(maxModeCreditLot.userId, owner.userId!);
}

function accountOwnerCondition(owner: MaxModeCreditOwner) {
  return owner.organizationId
    ? eq(maxModeCreditAccount.organizationId, owner.organizationId)
    : eq(maxModeCreditAccount.userId, owner.userId!);
}

function spendableLots(owner: MaxModeCreditOwner, now: Date) {
  return and(
    lotOwnerCondition(owner),
    gt(maxModeCreditLot.remainingUnits, 0),
    gt(maxModeCreditLot.expiresAt, now),
  );
}

export function isValidCreditAmount(credits: number) {
  return (
    Number.isInteger(credits) && credits >= MAX_MODE_CREDIT_MIN && credits <= MAX_MODE_CREDIT_MAX
  );
}

/** Unexpired, unspent units of the owner. */
export async function getMaxModeCreditUnits(
  owner: MaxModeCreditOwner,
  now = new Date(),
  database: Pick<typeof db, "select"> = db,
) {
  const [row] = await database
    .select({ units: sql<string | null>`sum(${maxModeCreditLot.remainingUnits})` })
    .from(maxModeCreditLot)
    .where(spendableLots(owner, now));
  return Number(row?.units ?? 0);
}

/**
 * Spend up to `units` from the lots that expire first, inside the caller's
 * transaction, and return what was spent. The lots are locked so team members
 * settling at once cannot spend the same credit twice.
 */
export async function spendMaxModeCredits(
  owner: MaxModeCreditOwner,
  units: number,
  now: Date,
  database: CreditDatabase,
) {
  if (units <= 0) return 0;
  const lots = await database
    .select({ id: maxModeCreditLot.id, remaining: maxModeCreditLot.remainingUnits })
    .from(maxModeCreditLot)
    .where(spendableLots(owner, now))
    .orderBy(asc(maxModeCreditLot.expiresAt), asc(maxModeCreditLot.createdAt))
    .for("update");
  let left = units;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(left, lot.remaining);
    await database
      .update(maxModeCreditLot)
      .set({ remainingUnits: sql`${maxModeCreditLot.remainingUnits} - ${take}` })
      .where(eq(maxModeCreditLot.id, lot.id));
    left -= take;
  }
  return units - left;
}

/** Record paid credits once per payment intent. Returns false for a repeat. */
export async function grantMaxModeCredits(
  {
    owner,
    credits,
    source,
    paymentIntentId,
    checkoutSessionId = null,
    amountPaid,
    currency,
    purchasedByUserId = null,
    purchasedAt,
  }: {
    owner: MaxModeCreditOwner;
    credits: number;
    source: "checkout" | "auto_top_up";
    paymentIntentId: string;
    checkoutSessionId?: string | null;
    amountPaid: number;
    currency: string;
    purchasedByUserId?: string | null;
    purchasedAt: Date;
  },
  database: Pick<typeof db, "insert"> = db,
) {
  const units = credits * MAX_MODE_CREDIT_UNITS;
  const inserted = await database
    .insert(maxModeCreditLot)
    .values({
      userId: owner.userId,
      organizationId: owner.organizationId,
      source,
      grantedUnits: units,
      remainingUnits: units,
      amountPaid,
      currency,
      stripePaymentIntentId: paymentIntentId,
      stripeCheckoutSessionId: checkoutSessionId,
      purchasedByUserId,
      expiresAt: new Date(purchasedAt.getTime() + MAX_MODE_CREDIT_VALIDITY_DAYS * DAY_MS),
    })
    .onConflictDoNothing({ target: maxModeCreditLot.stripePaymentIntentId })
    .returning({ id: maxModeCreditLot.id });
  return inserted.length > 0;
}

/** A refund or dispute takes back what is left of the lot it paid for. */
export async function revokeMaxModeCredits(paymentIntentId: string) {
  await db
    .update(maxModeCreditLot)
    .set({
      revokedUnits: sql`${maxModeCreditLot.revokedUnits} + ${maxModeCreditLot.remainingUnits}`,
      remainingUnits: 0,
    })
    .where(eq(maxModeCreditLot.stripePaymentIntentId, paymentIntentId));
}

/** A won dispute gives the revoked units back (still bounded by the lot's expiry). */
export async function restoreMaxModeCredits(paymentIntentId: string) {
  await db
    .update(maxModeCreditLot)
    .set({
      remainingUnits: sql`${maxModeCreditLot.remainingUnits} + ${maxModeCreditLot.revokedUnits}`,
      revokedUnits: 0,
    })
    .where(eq(maxModeCreditLot.stripePaymentIntentId, paymentIntentId));
}

export type MaxModeCreditLotSummary = {
  id: string;
  source: string;
  grantedCredits: number;
  remainingCredits: number;
  expiresAt: Date;
  createdAt: Date;
  expired: boolean;
};

export type MaxModeCreditSummary = {
  balanceCredits: number;
  /** Max Mode credits spent this UTC month by the owner's plan. */
  usedCreditsThisMonth: number;
  nextExpiry: { credits: number; expiresAt: Date } | null;
  lots: MaxModeCreditLotSummary[];
  autoTopUp: {
    enabled: boolean;
    thresholdCredits: number;
    amountCredits: number;
    hasPaymentMethod: boolean;
    lastError: string | null;
    lastTopUpAt: Date | null;
  };
};

const unitsToCredits = (units: number) => Math.round(usageUnitsToUsd(units) * 100) / 100;

export async function getMaxModeCreditSummary(
  owner: MaxModeCreditOwner,
  now = new Date(),
): Promise<MaxModeCreditSummary> {
  const ownerBillingCondition = owner.organizationId
    ? eq(billing.organizationId, owner.organizationId)
    : and(eq(billing.userId, owner.userId!), sql`${billing.organizationId} IS NULL`);
  const [lots, [account], [used]] = await Promise.all([
    db
      .select()
      .from(maxModeCreditLot)
      .where(lotOwnerCondition(owner))
      .orderBy(desc(maxModeCreditLot.createdAt))
      .limit(20),
    db.select().from(maxModeCreditAccount).where(accountOwnerCondition(owner)).limit(1),
    db
      .select({ units: sql<string | null>`sum(${usageReservation.maxModeAmount})` })
      .from(usageReservation)
      .innerJoin(billing, eq(usageReservation.billingId, billing.id))
      .where(
        and(
          ownerBillingCondition,
          isNotNull(usageReservation.settledAt),
          sql`${usageReservation.createdAt} >= ${usageMonthStart(now).toISOString()}::timestamptz`,
        ),
      ),
  ]);
  const spendable = lots
    .filter((lot) => lot.remainingUnits > 0 && lot.expiresAt > now)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const balanceUnits = await getMaxModeCreditUnits(owner, now);
  return {
    balanceCredits: unitsToCredits(balanceUnits),
    usedCreditsThisMonth: unitsToCredits(Number(used?.units ?? 0)),
    nextExpiry: spendable[0]
      ? {
          credits: unitsToCredits(spendable[0].remainingUnits),
          expiresAt: spendable[0].expiresAt,
        }
      : null,
    lots: lots.map((lot) => ({
      id: lot.id,
      source: lot.source,
      grantedCredits: unitsToCredits(lot.grantedUnits),
      remainingCredits: unitsToCredits(lot.remainingUnits),
      expiresAt: lot.expiresAt,
      createdAt: lot.createdAt,
      expired: lot.expiresAt <= now,
    })),
    autoTopUp: {
      enabled: account?.autoTopUpEnabled ?? false,
      thresholdCredits: account?.autoTopUpThresholdCredits ?? 5,
      amountCredits: account?.autoTopUpAmountCredits ?? 10,
      hasPaymentMethod: Boolean(account?.paymentMethodId),
      lastError: account?.lastAutoTopUpError ?? null,
      lastTopUpAt: account?.lastAutoTopUpAt ?? null,
    },
  };
}

function ownerMetadata(owner: MaxModeCreditOwner): Record<string, string> {
  return owner.organizationId
    ? { organizationId: owner.organizationId }
    : { creditUserId: owner.userId! };
}

/** The owner named by a credit checkout's or top-up's Stripe metadata. */
export function creditOwnerFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): MaxModeCreditOwner | null {
  if (metadata?.purpose !== MAX_MODE_CREDIT_PURPOSE) return null;
  if (metadata.organizationId) return { userId: null, organizationId: metadata.organizationId };
  return metadata.creditUserId ? { userId: metadata.creditUserId, organizationId: null } : null;
}

/** A Stripe-hosted checkout for `credits` credits; returns its URL. */
export async function createMaxModeCreditCheckout({
  owner,
  credits,
  stripeCustomerId,
  purchasedByUserId,
  saveCard,
  returnPath,
}: {
  owner: MaxModeCreditOwner;
  credits: number;
  stripeCustomerId: string;
  purchasedByUserId: string;
  saveCard: boolean;
  returnPath: string;
}) {
  if (!isValidCreditAmount(credits)) throw new Error("Invalid credit amount.");
  const origin = new URL(env.NEXT_PUBLIC_BETTER_AUTH_URL).origin;
  const metadata = {
    purpose: MAX_MODE_CREDIT_PURPOSE,
    credits: String(credits),
    purchasedByUserId,
    ...ownerMetadata(owner),
  };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomerId,
    client_reference_id: purchasedByUserId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: MAX_MODE_CREDIT_CURRENCY,
          unit_amount: credits * 100,
          product_data: {
            name: `Max Mode credits (${credits})`,
            description: `Valid for ${MAX_MODE_CREDIT_VALIDITY_DAYS} days after purchase.`,
          },
        },
      },
    ],
    adaptive_pricing: { enabled: true },
    metadata,
    payment_intent_data: {
      metadata,
      // A saved card lets auto top-up charge it off session later.
      ...(saveCard ? { setup_future_usage: "off_session" as const } : {}),
    },
    payment_method_options: checkoutCardPaymentMethodOptions,
    success_url: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}credits=success`,
    cancel_url: `${origin}${returnPath}`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

/** Grant a paid credit checkout; called from the Stripe webhook. */
export async function grantMaxModeCreditCheckout(session: Stripe.Checkout.Session) {
  const owner = creditOwnerFromMetadata(session.metadata);
  const credits = Number(session.metadata?.credits);
  if (!owner || !isValidCreditAmount(credits) || session.payment_status !== "paid") return false;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!paymentIntentId) return false;
  const granted = await grantMaxModeCredits({
    owner,
    credits,
    source: "checkout",
    paymentIntentId,
    checkoutSessionId: session.id,
    amountPaid: session.amount_total ?? credits * 100,
    currency: session.currency ?? MAX_MODE_CREDIT_CURRENCY,
    purchasedByUserId: session.metadata?.purchasedByUserId ?? null,
    purchasedAt: new Date(session.created * 1000),
  });
  if (granted) await enableMaxModeForOwner(owner);
  // Keep the card the buyer agreed to save for off-session top-ups.
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (intent.setup_future_usage === "off_session" && intent.payment_method) {
    const paymentMethodId =
      typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method.id;
    await saveAutoTopUpPaymentMethod(owner, paymentMethodId);
  }
  return granted;
}

/** Buying credits turns Max Mode on, so the purchase is usable at once. */
async function enableMaxModeForOwner(owner: MaxModeCreditOwner) {
  await db
    .update(billing)
    .set({ maxModeEnabled: true })
    .where(
      owner.organizationId
        ? eq(billing.organizationId, owner.organizationId)
        : and(eq(billing.userId, owner.userId!), sql`${billing.organizationId} IS NULL`),
    );
}

async function upsertCreditAccount(
  owner: MaxModeCreditOwner,
  values: Partial<typeof maxModeCreditAccount.$inferInsert>,
) {
  const [existing] = await db
    .select({ id: maxModeCreditAccount.id })
    .from(maxModeCreditAccount)
    .where(accountOwnerCondition(owner))
    .limit(1);
  if (existing) {
    await db
      .update(maxModeCreditAccount)
      .set(values)
      .where(eq(maxModeCreditAccount.id, existing.id));
    return;
  }
  await db
    .insert(maxModeCreditAccount)
    .values({ userId: owner.userId, organizationId: owner.organizationId, ...values })
    .onConflictDoNothing();
  // A concurrent insert won the unique index: apply the values to its row.
  await db.update(maxModeCreditAccount).set(values).where(accountOwnerCondition(owner));
}

async function saveAutoTopUpPaymentMethod(owner: MaxModeCreditOwner, paymentMethodId: string) {
  await upsertCreditAccount(owner, { paymentMethodId });
}

export async function updateMaxModeAutoTopUp(
  owner: MaxModeCreditOwner,
  settings: { enabled: boolean; thresholdCredits: number; amountCredits: number },
) {
  if (
    !Number.isInteger(settings.thresholdCredits) ||
    settings.thresholdCredits < MAX_MODE_AUTO_TOP_UP_THRESHOLD_MIN ||
    settings.thresholdCredits > MAX_MODE_AUTO_TOP_UP_THRESHOLD_MAX
  )
    return { success: false as const, error: "Invalid auto top-up threshold." };
  if (!isValidCreditAmount(settings.amountCredits))
    return { success: false as const, error: "Invalid auto top-up amount." };
  // One top-up must lift the balance back over the threshold.
  if (settings.amountCredits < settings.thresholdCredits)
    return {
      success: false as const,
      error: "The auto top-up amount must be at least the threshold.",
    };
  await upsertCreditAccount(owner, {
    autoTopUpEnabled: settings.enabled,
    autoTopUpThresholdCredits: settings.thresholdCredits,
    autoTopUpAmountCredits: settings.amountCredits,
    ...(settings.enabled ? { lastAutoTopUpError: null } : {}),
  });
  return { success: true as const };
}

/** The owner's Stripe customer and the card an off-session top-up can charge. */
async function resolveTopUpPaymentSource(
  owner: MaxModeCreditOwner,
  savedPaymentMethod: string | null,
) {
  const [record] = await db
    .select({
      stripeCustomerId: billing.stripeCustomerId,
      stripeSubscriptionId: billing.stripeSubscriptionId,
    })
    .from(billing)
    .where(
      owner.organizationId
        ? eq(billing.organizationId, owner.organizationId)
        : and(eq(billing.userId, owner.userId!), sql`${billing.organizationId} IS NULL`),
    )
    .orderBy(asc(billing.createdAt), asc(billing.id))
    .limit(1);
  if (!record) return null;
  if (savedPaymentMethod)
    return { customer: record.stripeCustomerId, paymentMethod: savedPaymentMethod };
  // Otherwise the plan's card: subscriptions keep it on the subscription, card
  // verification on the customer.
  if (record.stripeSubscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(record.stripeSubscriptionId);
    const method = subscription.default_payment_method;
    if (method)
      return {
        customer: record.stripeCustomerId,
        paymentMethod: typeof method === "string" ? method : method.id,
      };
  }
  const customer = await stripe.customers.retrieve(record.stripeCustomerId);
  if (customer.deleted) return null;
  const method = customer.invoice_settings?.default_payment_method;
  return method
    ? {
        customer: record.stripeCustomerId,
        paymentMethod: typeof method === "string" ? method : method.id,
      }
    : null;
}

function describeTopUpError(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message.slice(0, 500);
  return "The card could not be charged.";
}

/**
 * Charge the owner's card for an auto top-up once the balance falls below the
 * threshold. A transaction-scoped advisory lock and a minimum interval keep
 * concurrent settlements to one charge; a failure turns auto top-up off.
 */
export async function maybeAutoTopUpMaxModeCredits(owner: MaxModeCreditOwner, now = new Date()) {
  if (isBillingDisabled) return false;
  const [account] = await db
    .select()
    .from(maxModeCreditAccount)
    .where(and(accountOwnerCondition(owner), eq(maxModeCreditAccount.autoTopUpEnabled, true)))
    .limit(1);
  if (!account) return false;
  if (
    account.lastAutoTopUpAt &&
    now.getTime() - account.lastAutoTopUpAt.getTime() < AUTO_TOP_UP_MIN_INTERVAL_MS
  )
    return false;
  const thresholdUnits = account.autoTopUpThresholdCredits * MAX_MODE_CREDIT_UNITS;
  if ((await getMaxModeCreditUnits(owner, now)) >= thresholdUnits) return false;

  const claimed = await db
    .update(maxModeCreditAccount)
    .set({ lastAutoTopUpAt: now })
    .where(
      and(
        eq(maxModeCreditAccount.id, account.id),
        eq(maxModeCreditAccount.autoTopUpEnabled, true),
        account.lastAutoTopUpAt
          ? eq(maxModeCreditAccount.lastAutoTopUpAt, account.lastAutoTopUpAt)
          : sql`${maxModeCreditAccount.lastAutoTopUpAt} IS NULL`,
      ),
    )
    .returning({ id: maxModeCreditAccount.id });
  // Another settlement claimed this top-up first.
  if (!claimed.length) return false;

  const credits = account.autoTopUpAmountCredits;
  const fail = async (message: string) => {
    await db
      .update(maxModeCreditAccount)
      .set({ autoTopUpEnabled: false, lastAutoTopUpError: message })
      .where(eq(maxModeCreditAccount.id, account.id));
    return false;
  };
  try {
    const source = await resolveTopUpPaymentSource(owner, account.paymentMethodId);
    if (!source) return fail("No saved card is available for auto top-up.");
    const metadata = {
      purpose: MAX_MODE_CREDIT_PURPOSE,
      credits: String(credits),
      autoTopUp: "true",
      ...ownerMetadata(owner),
    };
    const intent = await stripe.paymentIntents.create(
      {
        amount: credits * 100,
        currency: MAX_MODE_CREDIT_CURRENCY,
        customer: source.customer,
        payment_method: source.paymentMethod,
        off_session: true,
        confirm: true,
        description: `Max Mode credits auto top-up (${credits})`,
        metadata,
      },
      { idempotencyKey: `max-mode-top-up:${account.id}:${now.getTime()}` },
    );
    if (intent.status !== "succeeded") return fail("The card needs authentication to be charged.");
    await grantMaxModeCredits({
      owner,
      credits,
      source: "auto_top_up",
      paymentIntentId: intent.id,
      amountPaid: intent.amount_received,
      currency: intent.currency,
      purchasedAt: now,
    });
    return true;
  } catch (error) {
    console.error("Max Mode auto top-up failed", { accountId: account.id, error });
    return fail(describeTopUpError(error));
  }
}

/** Grant an off-session top-up the webhook confirmed (idempotent with the direct grant). */
export async function grantMaxModeCreditTopUp(intent: Stripe.PaymentIntent) {
  if (intent.metadata?.autoTopUp !== "true" || intent.status !== "succeeded") return false;
  const owner = creditOwnerFromMetadata(intent.metadata);
  const credits = Number(intent.metadata.credits);
  if (!owner || !isValidCreditAmount(credits)) return false;
  return grantMaxModeCredits({
    owner,
    credits,
    source: "auto_top_up",
    paymentIntentId: intent.id,
    amountPaid: intent.amount_received,
    currency: intent.currency,
    purchasedAt: new Date(intent.created * 1000),
  });
}
