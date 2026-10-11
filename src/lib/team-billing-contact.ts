import { and, asc, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { billing, member, user } from "@/db/schema";
import { isBillingDisabled } from "@/lib/billing-config";
import { stripe } from "@/lib/stripe";
import { findTeamBillingRecord } from "@/lib/team-billing-record";

/**
 * Teams whose billing rows name this user as their billing contact. Account
 * deletion reads this first: the `billing.user_id` SET NULL hides it afterwards.
 */
export async function findTeamBillingContactOrganizations(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ organizationId: billing.organizationId })
    .from(billing)
    .where(and(eq(billing.userId, userId), isNotNull(billing.organizationId)));
  return rows.flatMap((row) => (row.organizationId ? [row.organizationId] : []));
}

type FormerMember = { userId: string; email: string | null | undefined };

/**
 * When a team's invoices may still go to a former member, send them to a current
 * owner instead: the customer's address is theirs, or the customer was created
 * for them (it then keeps their address from that time, which may since have
 * changed). An address the team set itself (an accounts inbox, say) on a customer
 * someone else created stays. Best-effort: the membership change or account
 * deletion has already happened.
 */
export async function redirectTeamBillingEmail(organizationId: string, former: FormerMember) {
  if (isBillingDisabled) return;
  try {
    const record = await findTeamBillingRecord(db, organizationId);
    if (!record) return;
    const customer = await stripe.customers.retrieve(record.stripeCustomerId);
    // Only the organization's own customer: a legacy row can reference a personal one.
    if (customer.deleted || customer.metadata?.organizationId !== organizationId) return;
    const formerEmail = former.email?.trim().toLowerCase();
    const customerEmail = customer.email?.trim().toLowerCase();
    const sentToFormer =
      (Boolean(formerEmail) && customerEmail === formerEmail) ||
      customer.metadata.userId === former.userId;
    if (!sentToFormer) return;
    // The last owner cannot leave or be removed, and owners cannot delete their
    // account, so one remains; guests are skipped for their placeholder addresses.
    const [owner] = await db
      .select({ email: user.email })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.role, "owner"),
          or(isNull(user.isAnonymous), eq(user.isAnonymous, false)),
        ),
      )
      .orderBy(asc(member.createdAt))
      .limit(1);
    if (!owner?.email) {
      console.warn("[team-billing] No owner to take over the team billing email", {
        organizationId,
      });
      return;
    }
    if (customerEmail === owner.email.trim().toLowerCase()) return;
    await stripe.customers.update(customer.id, { email: owner.email });
  } catch (error) {
    console.error("[team-billing] Failed to update the team billing email:", error);
  }
}

/**
 * A member who left or was removed stops being the team's billing contact. The
 * team's billing row stays with the organization, so it is never deleted here.
 * The invoice address is checked whether or not they were the contact: the
 * customer can predate the current row. Never throws.
 */
export async function releaseTeamBillingContact(organizationId: string, userId: string) {
  try {
    await db
      .update(billing)
      .set({ userId: null, updatedAt: new Date() })
      .where(and(eq(billing.organizationId, organizationId), eq(billing.userId, userId)));
  } catch (error) {
    console.error("[team-billing] Failed to release the team billing contact:", error);
  }
  try {
    const [former] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    await redirectTeamBillingEmail(organizationId, { userId, email: former?.email });
  } catch (error) {
    console.error("[team-billing] Failed to update the team billing email:", error);
  }
}
