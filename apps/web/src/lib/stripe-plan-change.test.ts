import type Stripe from "stripe";
import { beforeEach, expect, test, vi } from "vitest";
import {
  getPendingPlanChange,
  releasePlanChangeSchedule,
  schedulePlanChangeAtPeriodEnd,
  syncScheduledSeatCount,
} from "./stripe-plan-change";

const schedules = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({ stripe: { subscriptionSchedules: schedules } }));

const PERIOD_START = 1_800_000_000;
const PERIOD_END = 1_802_592_000;

/** The schedule Stripe makes from a subscription: one phase mirroring it until the period ends. */
function scheduleOf(items: { price: string; quantity?: number }[], discounts: object[] = []) {
  return {
    id: "schedule",
    status: "active",
    metadata: {},
    current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
    phases: [{ start_date: PERIOD_START, end_date: PERIOD_END, items, discounts, metadata: null }],
  };
}

const subscription = (schedule: unknown = null) =>
  ({ id: "sub", schedule }) as unknown as Stripe.Subscription;
const item = { id: "item", price: { id: "price_pro" } } as unknown as Stripe.SubscriptionItem;
const plusMonthly = {
  id: "price_plus",
  recurring: { interval: "month", interval_count: 1 },
} as unknown as Stripe.Price;

beforeEach(() => {
  vi.clearAllMocks();
  schedules.update.mockResolvedValue({});
  schedules.release.mockResolvedValue({});
});

test("a downgrade keeps the paid period and switches the price when it ends", async () => {
  schedules.create.mockResolvedValue(
    scheduleOf(
      [{ price: "price_pro", quantity: 1 }, { price: "price_max_mode_meter" }],
      [{ coupon: "flash", discount: null, promotion_code: null }],
    ),
  );

  const pending = await schedulePlanChangeAtPeriodEnd({
    subscription: subscription(),
    item,
    price: plusMonthly,
    plan: { id: "plus_monthly" },
    metadata: { userId: "user", planId: "plus_monthly" },
  });

  expect(pending).toEqual({ planId: "plus_monthly", effectiveAt: new Date(PERIOD_END * 1000) });
  expect(schedules.create).toHaveBeenCalledWith({ from_subscription: "sub" });
  expect(schedules.update).toHaveBeenCalledWith("schedule", {
    end_behavior: "release",
    // No credit for the time left and nothing charged today.
    proration_behavior: "none",
    metadata: { pendingPlanId: "plus_monthly" },
    phases: [
      {
        items: [{ price: "price_pro", quantity: 1 }, { price: "price_max_mode_meter" }],
        start_date: PERIOD_START,
        end_date: PERIOD_END,
        discounts: [{ coupon: "flash" }],
      },
      {
        // The meter item is carried over; only the plan item changes.
        items: [{ price: "price_plus", quantity: 1 }, { price: "price_max_mode_meter" }],
        duration: { interval: "month", interval_count: 1 },
        proration_behavior: "none",
        metadata: { userId: "user", planId: "plus_monthly" },
        discounts: [{ coupon: "flash" }],
      },
    ],
  });
});

test("a team change starts its new phase with the given seats and replaces a pending one", async () => {
  schedules.retrieve.mockResolvedValue(scheduleOf([{ price: "price_pro", quantity: 2 }]));

  await schedulePlanChangeAtPeriodEnd({
    subscription: subscription("schedule"),
    item,
    price: plusMonthly,
    plan: { id: "pro_team_monthly" },
    quantity: 5,
    metadata: {},
  });

  expect(schedules.create).not.toHaveBeenCalled();
  const phases = schedules.update.mock.calls[0][1].phases;
  expect(phases).toHaveLength(2);
  expect(phases[1].items).toEqual([{ price: "price_plus", quantity: 5 }]);
});

test("a schedule that could not be filled in is not left attached", async () => {
  schedules.create.mockResolvedValue(scheduleOf([{ price: "price_pro", quantity: 1 }]));
  schedules.update.mockRejectedValue(new Error("Stripe refused the phases"));

  await expect(
    schedulePlanChangeAtPeriodEnd({
      subscription: subscription(),
      item,
      price: plusMonthly,
      plan: { id: "plus_monthly" },
      metadata: {},
    }),
  ).rejects.toThrow("Stripe refused the phases");
  expect(schedules.release).toHaveBeenCalledWith("schedule");
});

test("the pending change is read from the expanded schedule", () => {
  const schedule = {
    ...scheduleOf([{ price: "price_pro", quantity: 1 }]),
    metadata: { pendingPlanId: "plus_monthly" },
  };
  schedule.phases.push({
    start_date: PERIOD_END,
    end_date: PERIOD_END + 2_592_000,
    items: [{ price: "price_plus", quantity: 1 }],
    discounts: [],
    metadata: null,
  });
  const during = new Date((PERIOD_START + 60) * 1000);

  expect(getPendingPlanChange(subscription(schedule), during)).toEqual({
    planId: "plus_monthly",
    effectiveAt: new Date(PERIOD_END * 1000),
  });
  // Not expanded, released, or already in its last phase: nothing pending.
  expect(getPendingPlanChange(subscription("schedule"), during)).toBeNull();
  expect(getPendingPlanChange(subscription(null), during)).toBeNull();
  expect(
    getPendingPlanChange(subscription({ ...schedule, status: "released" }), during),
  ).toBeNull();
  expect(
    getPendingPlanChange(subscription(schedule), new Date((PERIOD_END + 60) * 1000)),
  ).toBeNull();
});

test("releasing drops the pending change and reports whether there was one", async () => {
  expect(await releasePlanChangeSchedule(subscription())).toBe(false);
  expect(schedules.release).not.toHaveBeenCalled();
  expect(await releasePlanChangeSchedule(subscription({ id: "schedule" }))).toBe(true);
  expect(schedules.release).toHaveBeenCalledWith("schedule");
});

test("a seat change reaches every phase of a pending team plan change", async () => {
  const schedule = scheduleOf([{ price: "price_pro", quantity: 2 }]);
  schedule.phases.push({
    start_date: PERIOD_END,
    end_date: PERIOD_END + 2_592_000,
    items: [{ price: "price_plus", quantity: 2 }],
    discounts: [],
    metadata: { planId: "pro_team_monthly" } as never,
  });
  schedules.retrieve.mockResolvedValue(schedule);

  await syncScheduledSeatCount(subscription("schedule"), 4);

  expect(schedules.update).toHaveBeenCalledWith("schedule", {
    proration_behavior: "none",
    phases: [
      {
        items: [{ price: "price_pro", quantity: 4 }],
        start_date: PERIOD_START,
        end_date: PERIOD_END,
        proration_behavior: "none",
      },
      {
        items: [{ price: "price_plus", quantity: 4 }],
        start_date: PERIOD_END,
        end_date: PERIOD_END + 2_592_000,
        proration_behavior: "none",
        metadata: { planId: "pro_team_monthly" },
      },
    ],
  });
  schedules.update.mockClear();
  await syncScheduledSeatCount(subscription(), 4);
  expect(schedules.update).not.toHaveBeenCalled();
});
