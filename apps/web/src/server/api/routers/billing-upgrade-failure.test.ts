import { getTableName } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import { billingRouter } from "@/server/api/routers/billing";
import { organizationRouter } from "@/server/api/routers/organization";
import { claimCardVerification } from "@/lib/billing-card-usage";

const state = vi.hoisted(() => ({
  record: {} as Record<string, unknown>,
  subscription: {} as Record<string, unknown>,
  update: vi.fn(),
  intent: vi.fn(),
  schedules: { create: vi.fn(), retrieve: vi.fn(), update: vi.fn(), release: vi.fn() },
}));
vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/billing-config", () => ({ isBillingDisabled: false }));
vi.mock("@/lib/team-billing", () => ({
  getOrgMemberCount: vi.fn(async () => 2),
  updateTeamSeatCount: vi.fn(),
}));
vi.mock("@/lib/billing-card-usage", () => ({
  claimCardVerification: vi.fn(),
  getBillingFingerprintUpdates: vi.fn(),
  getCustomerPrimaryCardInfo: vi.fn(),
  grantCardVerificationFlashOffer: vi.fn(async () => true),
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    prices: {
      list: async () => ({
        data: [{ id: "higher-price", recurring: { interval: "month" }, lookup_key: "pro_monthly" }],
      }),
    },
    subscriptions: {
      list: async () => ({ data: [state.subscription] }),
      retrieve: async () => state.subscription,
      update: state.update,
    },
    subscriptionSchedules: state.schedules,
    paymentIntents: { retrieve: state.intent },
  },
}));

function database() {
  const database = {
    execute: async () => {},
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => ({
        where: () => {
          const rows =
            getTableName(table) === "member" ? [{ role: "owner", userId: "user" }] : [state.record];
          const result = Promise.resolve(rows);
          return Object.assign(result, {
            limit: () => result,
            orderBy: () => ({ limit: () => result }),
          });
        },
      }),
    }),
    insert: () => ({
      values: (updates: Record<string, unknown>) => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            Object.assign(state.record, updates);
            return [state.record];
          },
        }),
      }),
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            Object.assign(state.record, updates);
            return [state.record];
          },
        }),
      }),
    }),
    transaction: async (run: (transaction: unknown) => Promise<unknown>) => run(database),
  };
  return database;
}
function context() {
  return {
    db: database(),
    session: { session: { userId: "user" }, user: { isAnonymous: false, emailVerified: true } },
    userId: "user",
  } as never;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.record = {
    id: "row",
    userId: "user",
    stripeCustomerId: "customer",
    stripeSubscriptionId: "sub",
    planId: "plus_monthly",
    status: "active",
    firstPaidAt: new Date(),
    maxModeEnabled: false,
  };
  state.subscription = {
    id: "sub",
    customer: "customer",
    status: "active",
    metadata: { planId: "plus_monthly" },
    items: {
      data: [
        {
          id: "item",
          price: {
            id: "lower-price",
            lookup_key: "plus_monthly",
            recurring: { interval: "month" },
          },
        },
      ],
    },
  };
  state.update.mockRejectedValue(new Error("Payment incomplete"));
});
test("failed personal upgrade requests restrictive Stripe payment behavior and retains the paid tier", async () => {
  await expect(
    billingRouter.createCaller(context()).changePlan({ planId: "pro_monthly" }),
  ).rejects.toThrow("Payment incomplete");
  expect(state.update).toHaveBeenCalledWith(
    "sub",
    expect.objectContaining({
      payment_behavior: "error_if_incomplete",
      proration_behavior: "always_invoice",
      // An upgrade starts a new billing cycle: paid in full, not prorated by the days left.
      billing_cycle_anchor: { type: "now" },
    }),
  );
  expect(state.record.planId).toBe("plus_monthly");
});
test("a downgrade is scheduled for the end of the paid period and changes nothing today", async () => {
  state.record.planId = "pro_monthly";
  state.subscription.metadata = { planId: "pro_monthly" };
  state.subscription.items = {
    data: [
      {
        id: "item",
        current_period_end: 1_900_000_000,
        price: { id: "pro-price", lookup_key: "pro_monthly", recurring: { interval: "month" } },
      },
    ],
  };
  state.schedules.create.mockResolvedValue({
    id: "schedule",
    current_phase: { start_date: 1_897_408_000, end_date: 1_900_000_000 },
    phases: [
      {
        start_date: 1_897_408_000,
        end_date: 1_900_000_000,
        items: [{ price: "pro-price", quantity: 1 }],
        discounts: [],
      },
    ],
  });

  const result = await billingRouter.createCaller(context()).changePlan({ planId: "plus_monthly" });

  expect(result).toMatchObject({
    planId: "pro_monthly",
    pendingPlanChange: { planId: "plus_monthly", effectiveAt: new Date(1_900_000_000 * 1000) },
  });
  // No direct update: no proration credit, no new billing cycle, no usage reset.
  expect(state.update).not.toHaveBeenCalled();
  expect(state.schedules.update).toHaveBeenCalledWith(
    "schedule",
    expect.objectContaining({ end_behavior: "release", proration_behavior: "none" }),
  );
  expect(state.record.planId).toBe("pro_monthly");
});
test("a downgrade is refused while the subscription is set to cancel", async () => {
  state.record.planId = "pro_monthly";
  state.subscription.cancel_at_period_end = true;
  state.subscription.items = {
    data: [
      {
        id: "item",
        price: { id: "pro-price", lookup_key: "pro_monthly", recurring: { interval: "month" } },
      },
    ],
  };
  await expect(
    billingRouter.createCaller(context()).changePlan({ planId: "plus_monthly" }),
  ).rejects.toThrow("Resume your subscription before changing its plan.");
  expect(state.schedules.create).not.toHaveBeenCalled();
});
test("cancelling releases a pending downgrade first", async () => {
  state.subscription.schedule = "schedule";
  state.update.mockResolvedValue({ ...state.subscription, cancel_at_period_end: true });
  await billingRouter.createCaller(context()).cancelSubscription();
  expect(state.schedules.release).toHaveBeenCalledWith("schedule");
  expect(state.update).toHaveBeenCalledWith(
    "sub",
    expect.objectContaining({ cancel_at_period_end: true }),
  );
});
test("failed team upgrade retains the original team tier", async () => {
  state.record.planId = "pro_team_monthly";
  state.record.organizationId = "team";
  state.subscription.metadata = { planId: "pro_team_monthly" };
  state.subscription.items = {
    data: [
      {
        id: "item",
        price: {
          id: "team-price",
          lookup_key: "pro_team_monthly",
          recurring: { interval: "month" },
        },
      },
    ],
  };
  await expect(
    organizationRouter
      .createCaller(context())
      .changeTeamPlan({ organizationId: "team", planId: "pro_team_yearly" }),
  ).rejects.toThrow("Payment incomplete");
  expect(state.update).toHaveBeenCalledWith(
    "sub",
    expect.objectContaining({ payment_behavior: "error_if_incomplete" }),
  );
  expect(state.record.planId).toBe("pro_team_monthly");
});
test.each([
  { userId: "other", purpose: "free_tier_verification", customer: "customer" },
  { userId: "user", purpose: "advertisement", customer: "customer" },
  { userId: "user", purpose: "free_tier_verification", customer: "other-customer" },
  { purpose: "free_tier_verification", customer: "customer" },
])(
  "card confirmation rejects foreign or wrong-purpose intents: %j",
  async ({ customer, ...metadata }) => {
    state.intent.mockResolvedValue({ customer, metadata, status: "requires_capture" });
    await expect(
      billingRouter.createCaller(context()).confirmCardSetup({ paymentIntentId: "intent" }),
    ).rejects.toThrow("does not belong");
    expect(claimCardVerification).not.toHaveBeenCalled();
  },
);
