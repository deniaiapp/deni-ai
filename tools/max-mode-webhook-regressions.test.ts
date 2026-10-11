import { beforeEach, expect, test, vi } from "vitest";
import { cancelOrgMembersPersonalSubscriptions, updateTeamSeatCount } from "@/lib/team-billing";

const state = vi.hoisted(() => ({
  event: {} as Record<string, unknown>,
  subscriptions: [] as Record<string, unknown>[],
  current: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
}));
vi.mock("@/env", () => ({
  env: { STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec_test" },
}));
vi.mock("@/lib/billing-card-usage", () => ({ getBillingFingerprintUpdates: async () => ({}) }));
vi.mock("@/lib/ad-checkout", () => ({
  activatePaidAd: vi.fn(),
  pauseReversedAdCharge: vi.fn(),
  releaseExpiredAdCheckout: vi.fn(),
}));
vi.mock("@/lib/max-mode", () => ({ syncMaxModeMeterPeriod: vi.fn() }));
vi.mock("@/lib/stripe-disputes", () => ({
  handleChargeDisputeClosed: vi.fn(),
  handleChargeDisputeCreated: vi.fn(),
  handleEarlyFraudWarning: vi.fn(),
}));
vi.mock("@/lib/team-billing", () => ({
  cancelOrgMembersPersonalSubscriptions: vi.fn(),
  getTeamBilling: vi.fn(),
  recordTeamAuditEvent: vi.fn(),
  updateTeamSeatCount: vi.fn(),
}));
vi.mock("@/lib/team-billing-record", () => ({ saveTeamBillingRecord: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    webhooks: { constructEvent: () => state.event },
    subscriptions: {
      list: async () => ({ data: state.subscriptions }),
      retrieve: async () => state.current,
    },
  },
}));
vi.mock("@/db/drizzle", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({
      set: (updates: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push(updates);
        },
      }),
    }),
  },
}));

const { POST } = await import("../src/app/api/stripe/webhook/route");

const meteredItems = {
  data: [
    { id: "si_basic", price: { lookup_key: "max_mode_basic_month" } },
    { id: "si_premium", price: { lookup_key: "max_mode_premium_month" } },
  ],
};

function deliver(type: string, object: Record<string, unknown>) {
  state.event = {
    type,
    data: { object: { object: "subscription", customer: "customer", ...object } },
  };
  return POST(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "{}",
    }),
  );
}

function deleteMeterSubscription() {
  return deliver("customer.subscription.deleted", {
    id: "sub_meter",
    metadata: { purpose: "max_mode", userId: "user" },
    items: meteredItems,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.subscriptions = [];
  state.current = null;
  state.updates = [];
});

test("canceling the Max Mode meter subscription turns Max Mode off", async () => {
  expect((await deleteMeterSubscription()).status).toBe(200);
  expect(state.updates).toEqual([
    expect.objectContaining({
      maxModeEnabled: false,
      stripeMeteredBasicItemId: null,
      stripeMeteredPremiumItemId: null,
    }),
  ]);
});

test("a replaced meter host keeps Max Mode on while meters live elsewhere", async () => {
  state.subscriptions = [{ id: "sub_new_meter", status: "active", items: meteredItems }];
  expect((await deleteMeterSubscription()).status).toBe(200);
  expect(state.updates).toEqual([]);
});

test("an ended monthly plan that hosted the meters turns Max Mode off", async () => {
  const response = await deliver("customer.subscription.deleted", {
    id: "sub_plan",
    metadata: { userId: "user", organizationId: "team", planId: "pro_team_monthly" },
    items: {
      data: [{ id: "si_plan", price: { lookup_key: "pro_team_monthly" } }, ...meteredItems.data],
    },
  });
  expect(response.status).toBe(200);
  expect(state.updates).toEqual([
    expect.objectContaining({
      maxModeEnabled: false,
      stripeMeteredBasicItemId: null,
      stripeMeteredPremiumItemId: null,
    }),
  ]);
});

test("an ended plan without meters leaves Max Mode alone", async () => {
  const response = await deliver("customer.subscription.deleted", {
    id: "sub_plan",
    metadata: { userId: "user", organizationId: "team", planId: "pro_team_yearly" },
    items: { data: [{ id: "si_plan", price: { lookup_key: "pro_team_yearly" } }] },
  });
  expect(response.status).toBe(200);
  expect(state.updates).toEqual([]);
});

test.each(["past_due", "unpaid", "paused", "incomplete"])(
  "a %s meter host suspends Max Mode but keeps its meter items",
  async (status) => {
    state.current = {
      id: "sub_meter",
      object: "subscription",
      customer: "customer",
      status,
      metadata: { purpose: "max_mode", userId: "user" },
      items: meteredItems,
    };
    expect((await deliver("customer.subscription.updated", state.current)).status).toBe(200);
    expect(state.updates).toEqual([{ maxModeEnabled: false, updatedAt: expect.any(Date) }]);
  },
);

// An ended host is the deletion handler's job: it knows whether a replacement took over.
test.each(["active", "trialing", "canceled"])(
  "a %s meter host update leaves Max Mode alone",
  async (status) => {
    state.current = {
      id: "sub_meter",
      object: "subscription",
      customer: "customer",
      status,
      metadata: { purpose: "max_mode", userId: "user" },
      items: meteredItems,
    };
    expect((await deliver("customer.subscription.updated", state.current)).status).toBe(200);
    expect(state.updates).toEqual([]);
  },
);

test("an activated team subscription bills every current member as a seat", async () => {
  state.current = {
    id: "sub_team",
    object: "subscription",
    customer: "customer",
    status: "active",
    metadata: { userId: "owner", organizationId: "team", planId: "pro_team_monthly" },
    items: {
      data: [
        {
          id: "si_plan",
          quantity: 1,
          current_period_end: 1_900_000_000,
          price: { id: "price_team", lookup_key: "pro_team_monthly" },
        },
      ],
    },
  };
  expect((await deliver("customer.subscription.updated", state.current)).status).toBe(200);
  expect(updateTeamSeatCount).toHaveBeenCalledWith("team");
  expect(cancelOrgMembersPersonalSubscriptions).toHaveBeenCalledWith("team");
});
