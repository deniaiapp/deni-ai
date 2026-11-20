import { and, eq, gt, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { createElement } from "react";
import { db } from "@/db/drizzle";
import { billing, user } from "@/db/schema";
import { env } from "@/env";
import { isBillingDisabled } from "@/lib/billing-config";
import { SUPPORT_EMAIL } from "@/lib/constants";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { stripe } from "@/lib/stripe";
import {
  canceledLongBefore,
  formatReminderEndDate,
  reminderLocale,
  reminderPlanName,
  scheduledEndOf,
  SUBSCRIPTION_ENDING_REMINDER_LEAD_MS,
} from "@/lib/subscription-ending-reminder";

const REMINDER_BATCH_SIZE = 50;

export type SubscriptionEndingReminderJobResult = {
  sent: number;
  /**
   * Claimed but not mailed: resumed or ended on Stripe, canceled within a week of
   * the end, or a plan this build does not know.
   */
  skipped: number;
  failed: number;
  healthy: boolean;
};

/**
 * Emails the owner of a personal subscription that was canceled and ends within
 * three days, once per cancellation, with a link to resume it. Most cancellations
 * are made on the day of purchase, a month before the plan ends, and nothing else
 * tells those users that it is about to.
 *
 * Safe on several replicas at once: a row is claimed (`cancel_reminder_sent_for`
 * set to its `cancel_at`) before its email is sent, and the claim is released when
 * sending fails so the next run retries. A process that dies between the two loses
 * that one reminder instead of sending it twice. Team plans are not reminded.
 */
export async function runSubscriptionEndingReminderJob(
  now = new Date(),
): Promise<SubscriptionEndingReminderJobResult> {
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (isBillingDisabled || !isEmailConfigured()) return { ...result, healthy: true };

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const due = await db
    .select({
      id: billing.id,
      cancelAt: billing.cancelAt,
      planId: billing.planId,
      stripeSubscriptionId: billing.stripeSubscriptionId,
      email: user.email,
      name: user.name,
    })
    .from(billing)
    .innerJoin(user, eq(user.id, billing.userId))
    .where(
      and(
        isNull(billing.organizationId),
        isNotNull(billing.stripeSubscriptionId),
        eq(billing.deletionPending, false),
        gt(billing.cancelAt, nowSeconds),
        lte(billing.cancelAt, nowSeconds + Math.floor(SUBSCRIPTION_ENDING_REMINDER_LEAD_MS / 1000)),
        sql`${billing.cancelReminderSentFor} IS DISTINCT FROM ${billing.cancelAt}`,
      ),
    )
    .limit(REMINDER_BATCH_SIZE);

  for (const row of due) {
    if (row.cancelAt === null || !row.stripeSubscriptionId) continue;
    const [claimed] = await db
      .update(billing)
      .set({ cancelReminderSentFor: row.cancelAt })
      .where(
        and(
          eq(billing.id, row.id),
          eq(billing.cancelAt, row.cancelAt),
          sql`${billing.cancelReminderSentFor} IS DISTINCT FROM ${billing.cancelAt}`,
        ),
      )
      .returning({ id: billing.id });
    if (!claimed) continue;

    try {
      // The billing row can be stale: a plan resumed in the Stripe portal must not be mailed.
      const subscription = await stripe.subscriptions.retrieve(row.stripeSubscriptionId);
      const endsAt = scheduledEndOf(subscription);
      const planName = reminderPlanName(row.planId);
      if (
        endsAt === null ||
        endsAt <= nowSeconds ||
        !planName ||
        !canceledLongBefore(subscription.canceled_at, endsAt)
      ) {
        result.skipped++;
        continue;
      }

      const locale = reminderLocale(subscription.currency);
      const endDate = formatReminderEndDate(new Date(endsAt * 1000), locale);
      const { SubscriptionEndingEmail, subscriptionEndingEmailSubject } =
        await import("@deniai/emails/subscription-ending-email");
      await sendEmail({
        to: row.email,
        subject: subscriptionEndingEmailSubject({ locale, planName, endDate }),
        react: createElement(SubscriptionEndingEmail, {
          locale,
          name: row.name,
          planName,
          endDate,
          billingUrl: new URL("/settings/billing", env.NEXT_PUBLIC_BETTER_AUTH_URL).toString(),
        }),
        // The email invites a reply; the sender address is not read.
        replyTo: SUPPORT_EMAIL,
      });
      result.sent++;
    } catch (error) {
      result.failed++;
      console.error("[subscription-ending-reminder] Failed to send a reminder", {
        billingId: row.id,
        error,
      });
      await db
        .update(billing)
        .set({ cancelReminderSentFor: null })
        .where(and(eq(billing.id, row.id), eq(billing.cancelReminderSentFor, row.cancelAt)))
        .catch((releaseError: unknown) => {
          console.error("[subscription-ending-reminder] Failed to release a claim", {
            billingId: row.id,
            error: releaseError,
          });
        });
    }
  }

  return { ...result, healthy: result.failed === 0 };
}
