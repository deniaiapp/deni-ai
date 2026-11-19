/** The UTC calendar month a usage amount belongs to: the usage period of accounts without a paid plan. */
export function usageMonthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** The first instant of the next UTC month: when the pool of an account without a paid plan resets. */
export function usageMonthEnd(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

/**
 * `at` moved by whole UTC months. The day of month is kept where the target month
 * has it and clamped to its last day otherwise (Jan 31 + 1 month = Feb 28), which is
 * also what PostgreSQL's `timestamp ± interval '1 month'` does.
 */
export function addUtcMonths(at: Date, months: number): Date {
  const month = at.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(at.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      at.getUTCFullYear(),
      month,
      Math.min(at.getUTCDate(), lastDay),
      at.getUTCHours(),
      at.getUTCMinutes(),
      at.getUTCSeconds(),
      at.getUTCMilliseconds(),
    ),
  );
}

/**
 * One usage period of the shared pool. `end` is when the pool resets and identifies
 * the period: a quota row belongs to it only while its `period_end` equals `end`.
 * `start` is the period's `product_usage.period_start` key, always one month before
 * `end` ({@link usagePeriodStart}); a period cut short by a plan change began later.
 */
export type UsageWindow = { start: Date; end: Date };

/** The `product_usage.period_start` key of the usage period that ends at `end`. */
export function usagePeriodStart(end: Date): Date {
  return addUtcMonths(end, -1);
}

/**
 * The usage period `at` falls in.
 *
 * A paid plan's pool follows its billing cycle: `cycleEnd` is the end of the plan's
 * current billing period (`billing.current_period_end`) and the pool resets on every
 * monthly step from it, so a yearly plan still gets a pool per month, and a renewal
 * the webhook has not recorded yet (`cycleEnd` in the past) still rolls the pool over.
 * One payment buys one pool, whatever the day of the month. Starting or upgrading a
 * plan starts a new billing cycle, which moves `cycleEnd` and so starts a new period.
 *
 * Without a paid plan (`cycleEnd` null: Free, education Go) the period is the UTC
 * calendar month.
 */
export function usagePeriodAt(cycleEnd: Date | null | undefined, at: Date): UsageWindow {
  if (!cycleEnd) {
    return { start: usageMonthStart(at), end: usageMonthEnd(at) };
  }
  let steps =
    (at.getUTCFullYear() - cycleEnd.getUTCFullYear()) * 12 +
    (at.getUTCMonth() - cycleEnd.getUTCMonth());
  while (addUtcMonths(cycleEnd, steps) <= at) steps++;
  while (addUtcMonths(cycleEnd, steps - 1) > at) steps--;
  const end = addUtcMonths(cycleEnd, steps);
  return { start: usagePeriodStart(end), end };
}
