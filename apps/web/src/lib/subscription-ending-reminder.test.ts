import { expect, test } from "vitest";
import {
  canceledLongBefore,
  formatReminderEndDate,
  reminderLocale,
  reminderPlanName,
  scheduledEndOf,
} from "./subscription-ending-reminder";

const DAY = 24 * 60 * 60;

test("names the plan family and refuses plans this build does not know", () => {
  expect(reminderPlanName("plus_monthly")).toBe("Plus");
  expect(reminderPlanName("pro_yearly")).toBe("Pro");
  expect(reminderPlanName("go_monthly")).toBe("Go");
  expect(reminderPlanName("pro_lifetime")).toBeNull();
  expect(reminderPlanName(null)).toBeNull();
});

test("writes to yen subscriptions in Japanese and to the rest in English", () => {
  expect(reminderLocale("jpy")).toBe("ja");
  expect(reminderLocale("JPY")).toBe("ja");
  expect(reminderLocale("usd")).toBe("en");
  expect(reminderLocale(null)).toBe("en");
});

test("formats the end date in Japan time for Japanese and UTC for English", () => {
  // 2026-11-22 20:00 UTC is already the 23rd in Japan.
  const endsAt = new Date("2026-11-22T20:00:00Z");
  expect(formatReminderEndDate(endsAt, "ja")).toBe("2026年11月23日");
  expect(formatReminderEndDate(endsAt, "en")).toBe("November 22, 2026");
});

test("a live subscription ends only while it is active and set to cancel", () => {
  expect(scheduledEndOf({ status: "active", cancel_at: 1_800_000_000 })).toBe(1_800_000_000);
  expect(scheduledEndOf({ status: "past_due", cancel_at: 1_800_000_000 })).toBe(1_800_000_000);
  // Resumed in the Stripe portal since the billing row was written.
  expect(scheduledEndOf({ status: "active", cancel_at: null })).toBeNull();
  expect(scheduledEndOf({ status: "canceled", cancel_at: 1_800_000_000 })).toBeNull();
});

test("a plan canceled within a week of its end is not reminded", () => {
  const endsAt = 1_800_000_000;
  expect(canceledLongBefore(endsAt - 30 * DAY, endsAt)).toBe(true);
  expect(canceledLongBefore(endsAt - 7 * DAY, endsAt)).toBe(true);
  expect(canceledLongBefore(endsAt - 2 * DAY, endsAt)).toBe(false);
  expect(canceledLongBefore(null, endsAt)).toBe(true);
});
