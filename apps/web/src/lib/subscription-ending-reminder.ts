import { getPlanTier, type PlanFamily } from "@deniai/billing";

/** How long before a canceled plan ends its owner is reminded. */
export const SUBSCRIPTION_ENDING_REMINDER_LEAD_MS = 3 * 24 * 60 * 60 * 1000;

export type ReminderLocale = "en" | "ja";

const PLAN_NAMES: Record<PlanFamily, string> = {
  go: "Go",
  plus: "Plus",
  pro: "Pro",
  team: "Pro Team",
};

/** Display name of a plan in the reminder; null for a plan this build does not know. */
export function reminderPlanName(planId: string | null | undefined): string | null {
  const family = getPlanTier(planId);
  return family ? PLAN_NAMES[family] : null;
}

/**
 * Accounts store no language. A subscription charged in yen was bought from the
 * Japanese price list, so its owner is written to in Japanese.
 */
export function reminderLocale(currency: string | null | undefined): ReminderLocale {
  return currency?.toLowerCase() === "jpy" ? "ja" : "en";
}

/** The day the plan ends, in Japan time for Japanese and UTC for English. */
export function formatReminderEndDate(endsAt: Date, locale: ReminderLocale): string {
  return locale === "ja"
    ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeZone: "Asia/Tokyo" }).format(endsAt)
    : new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(endsAt);
}

/**
 * When a live Stripe subscription is set to end, in Unix seconds, or null when it
 * renews (resumed since the billing row was written) or has already ended.
 */
export function scheduledEndOf(subscription: {
  status: string;
  cancel_at: number | null;
}): number | null {
  if (subscription.status !== "active" && subscription.status !== "past_due") return null;
  // Stripe fills `cancel_at` for a cancellation at the period end as well.
  return subscription.cancel_at;
}

/** A plan canceled this close to its end is not reminded: its owner has just decided. */
export const SUBSCRIPTION_ENDING_REMINDER_MIN_NOTICE_SECONDS = 7 * 24 * 60 * 60;

/** Whether the cancellation was made long enough before `endsAt` (Unix seconds) to be forgotten. */
export function canceledLongBefore(canceledAt: number | null, endsAt: number): boolean {
  return (
    canceledAt === null || endsAt - canceledAt >= SUBSCRIPTION_ENDING_REMINDER_MIN_NOTICE_SECONDS
  );
}
