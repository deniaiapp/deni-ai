import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { APIError } from "better-auth/api";
import { db } from "@/db/drizzle";
import { billing, member, usageReservation } from "@/db/schema";
import { env } from "@/env";
import { stripe } from "@/lib/stripe";
import { escapeStripeSearchValue } from "@/lib/stripe-search";
import {
  classifyDeletionSubscriptions,
  getPersonalCustomerOwnership,
  type AccountDeletionStatus,
} from "@/lib/account-deletion-policy";
import { isMaxModeOnlySubscription, isMeteredMaxModePrice } from "@/lib/stripe-subscriptions";

async function hasPendingUsage(userId: string, database: Pick<typeof db, "select"> = db) {
  const [reservation] = await database
    .select({ id: usageReservation.id })
    .from(usageReservation)
    .where(and(eq(usageReservation.userId, userId), isNull(usageReservation.settledAt)))
    .limit(1);
  return Boolean(reservation);
}

async function hasUnpaidInvoices(customerIds: Set<string>) {
  for (const customer of customerIds) {
    for await (const invoice of stripe.invoices.list({ customer, limit: 100 })) {
      if (
        invoice.status === "draft" ||
        ((invoice.status === "open" || invoice.status === "uncollectible") &&
          invoice.amount_remaining > 0)
      )
        return true;
    }
  }
  return false;
}

async function personalDeletionStatus(
  userId: string,
  customerIds: Set<string>,
  subscriptions: Stripe.Subscription[],
): Promise<AccountDeletionStatus> {
  const status = classifyDeletionSubscriptions(subscriptions);
  if (status.state === "active") return status;
  const meteredCancellation =
    status.state === "cancelPending" &&
    subscriptions.some(
      (sub) =>
        sub.status !== "canceled" &&
        sub.status !== "incomplete_expired" &&
        sub.items.data.some(
          (item) =>
            isMeteredMaxModePrice(item.price) || item.price.recurring?.usage_type === "metered",
        ),
    );
  if (
    meteredCancellation ||
    (await hasPendingUsage(userId)) ||
    (await hasUnpaidInvoices(customerIds))
  ) {
    return { state: "billingPending", periodEnd: status.periodEnd };
  }
  return status;
}

async function getPersonalCustomerIds(
  userId: string,
  { includeOrphans }: { includeOrphans: boolean },
) {
  const [record] = await db
    .select({ customerId: billing.stripeCustomerId })
    .from(billing)
    .where(and(eq(billing.userId, userId), isNull(billing.organizationId)))
    .limit(1);
  const ids = new Set<string>();
  if (!env.STRIPE_SECRET_KEY?.trim()) {
    if (record?.customerId)
      throw new Error("Stripe is unavailable; account deletion cannot be completed.");
    return ids;
  }
  if (record?.customerId) {
    const customer = await stripe.customers.retrieve(record.customerId);
    if (!customer.deleted) {
      // Legacy email matching could point a personal billing row at a team customer.
      // The team customer belongs to its organization and must never be deleted here.
      const ownership = getPersonalCustomerOwnership(userId, customer.metadata);
      if (ownership === "team") {
        console.warn("Ignoring team customer referenced by personal billing on account deletion", {
          userId,
          customerId: customer.id,
        });
      } else if (ownership === "foreign") {
        // A different person's personal customer requires manual reconciliation.
        throw new APIError("BAD_REQUEST", {
          message: "Billing customer ownership needs to be resolved before account deletion.",
        });
      } else {
        ids.add(customer.id);
      }
    }
  }
  // Include orphaned personal customers from older concurrent creation attempts.
  // Stripe Search has a low account-wide rate limit shared with customer creation,
  // so only the deletion itself pays for it; the status preview skips it.
  if (!includeOrphans) return ids;
  let page: string | undefined;
  do {
    const result = await stripe.customers.search({
      query: `metadata['userId']:'${escapeStripeSearchValue(userId)}'`,
      limit: 100,
      page,
    });
    for (const customer of result.data) {
      if (!customer.metadata.organizationId) ids.add(customer.id);
    }
    page = result.next_page ?? undefined;
  } while (page);
  return ids;
}

async function getSubscriptions(customerId: string) {
  const subscriptions: Stripe.Subscription[] = [];
  for await (const sub of stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  })) {
    subscriptions.push(sub);
  }
  return subscriptions;
}

async function isTeamOwner(userId: string) {
  const [ownership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, "owner")))
    .limit(1);
  return Boolean(ownership);
}

/**
 * Why a personal customer's cards must stay attached: a running subscription
 * ("active"), or one still due to invoice before it ends, including metered
 * usage billed in arrears, a Max Mode meter host with usage left to invoice,
 * or money owed ("billingPending"). Null when the cards can be removed.
 */
export async function getCardRemovalBlocker(
  customerId: string,
): Promise<"active" | "billingPending" | null> {
  const subscriptions = await getSubscriptions(customerId);
  // Nothing cancels a Max Mode meter host when the yearly plan that needed it
  // ends, so the host only blocks while its next invoice still bills usage.
  const hosts = subscriptions.filter((sub) => isMaxModeOnlySubscription(sub));
  const status = classifyDeletionSubscriptions(
    subscriptions.filter((sub) => !isMaxModeOnlySubscription(sub)),
  );
  if (status.state === "active") return "active";
  if (
    status.state === "cancelPending" ||
    (await hasUnbilledMeterUsage(hosts)) ||
    (await hasUnpaidInvoices(new Set([customerId])))
  ) {
    return "billingPending";
  }
  return null;
}

async function hasUnbilledMeterUsage(hosts: Stripe.Subscription[]) {
  for (const host of hosts) {
    if (classifyDeletionSubscriptions([host]).state === "ready") continue;
    const preview = await stripe.invoices.createPreview({
      customer: typeof host.customer === "string" ? host.customer : host.customer.id,
      subscription: host.id,
    });
    if (preview.amount_due > 0) return true;
  }
  return false;
}

/** Preview for the deletion dialog; `deletePersonalStripeCustomers` rechecks everything. */
export async function getAccountDeletionStatus(userId: string): Promise<AccountDeletionStatus> {
  if (await isTeamOwner(userId)) return { state: "teamOwner", periodEnd: null };
  // A team subscription belongs to its organization and keeps running after a
  // former owner or billing contact leaves, so only personal billing is checked.
  const customerIds = await getPersonalCustomerIds(userId, { includeOrphans: false });
  const all = (await Promise.all([...customerIds].map(getSubscriptions))).flat();
  return personalDeletionStatus(userId, customerIds, all);
}

/**
 * Personal billing rows are deleted with their user. `billing.user_id` is
 * SET NULL so team rows outlive their billing contact, which would leave a
 * personal row behind without a user, so every account deletion path (the
 * user delete database hook) removes them right before the user row.
 */
export async function deletePersonalBillingRecords(userId: string) {
  await db.delete(billing).where(and(eq(billing.userId, userId), isNull(billing.organizationId)));
}

// Teams whose billing contact an account deletion cleared, for its user delete hooks.
const detachedTeamBillingContacts = new Map<string, Set<string>>();

/**
 * The teams `deletePersonalStripeCustomers` stopped naming this user as their
 * billing contact. Their rows no longer reference the user, so the user delete
 * hooks cannot find them on their own.
 */
export function takeDetachedTeamBillingContacts(userId: string): string[] {
  const organizationIds = detachedTeamBillingContacts.get(userId);
  detachedTeamBillingContacts.delete(userId);
  return [...(organizationIds ?? [])];
}

/** Run in better-auth's beforeDelete hook, before the personal billing row is deleted. */
export async function deletePersonalStripeCustomers(userId: string) {
  // Check again at deletion time; bypassing the UI or an in-flight transfer
  // must not leave an organization without its owner.
  if (await isTeamOwner(userId)) {
    throw new APIError("BAD_REQUEST", {
      message: "Delete your team or transfer its ownership before deleting your account.",
    });
  }
  const customerIds = await getPersonalCustomerIds(userId, { includeOrphans: true });
  const subscriptions = (await Promise.all([...customerIds].map(getSubscriptions))).flat();
  const status = await personalDeletionStatus(userId, customerIds, subscriptions);
  if (status.state === "billingPending")
    throw new APIError("BAD_REQUEST", {
      message:
        "Wait for usage billing to finish and pay outstanding invoices before deleting your account.",
    });
  if (status.state === "active") {
    throw new APIError("BAD_REQUEST", {
      message: "Cancel your active subscription before deleting your account.",
    });
  }
  // Freeze new reservations under the same account lock before Stripe I/O.
  // Retry remains possible if Stripe or the later account deletion fails.
  const detached = await db.transaction(
    async (tx) => {
      await tx.execute(sql`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`);
      if (await hasPendingUsage(userId, tx))
        throw new APIError("BAD_REQUEST", { message: "Usage settlement is still in progress." });
      await tx
        .update(billing)
        .set({ deletionPending: true })
        .where(and(eq(billing.userId, userId), isNull(billing.organizationId)));
      // Team rows outlive their billing contact. Clear it here, before Stripe and
      // before better-auth removes sessions and accounts, rather than leave it to
      // the FK: on a database without the SET NULL migration, user_id is still
      // NOT NULL with ON DELETE CASCADE, so this fails the deletion instead of
      // letting the cascade delete the team's billing row.
      return tx
        .update(billing)
        .set({ userId: null, updatedAt: new Date() })
        .where(and(eq(billing.userId, userId), isNotNull(billing.organizationId)))
        .returning({ organizationId: billing.organizationId });
    },
    { isolationLevel: "read committed" },
  );
  // Merged, so a retry after a later failure still redirects these teams' invoices.
  const organizationIds = detachedTeamBillingContacts.get(userId) ?? new Set<string>();
  for (const { organizationId } of detached) {
    if (organizationId) organizationIds.add(organizationId);
  }
  if (organizationIds.size) detachedTeamBillingContacts.set(userId, organizationIds);
  if (status.state === "cancelPending") {
    // Immediate deletion forfeits remaining access, with no proration or refund.
    for (const sub of subscriptions) {
      if (sub.status === "canceled" || sub.status === "incomplete_expired") continue;
      await stripe.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false });
    }
  }
  for (const id of customerIds) {
    const customer = await stripe.customers.retrieve(id);
    if (!customer.deleted) await stripe.customers.del(id);
  }
}
