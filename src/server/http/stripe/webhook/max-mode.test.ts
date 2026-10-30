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
vi.mock("@/lib/max-mode-credits", () => ({
  MAX_MODE_CREDIT_PURPOSE: "max_mode_credits",
  grantMaxModeCreditCheckout: vi.fn(),
  grantMaxModeCreditTopUp: vi.fn(),
  restoreMaxModeCredits: vi.fn(),
  revokeMaxModeCredits: vi.fn(),
}));
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
    // A refunded charge first looks for a lifetime purchase it paid for.
    checkout: { sessions: { list: async () => ({ data: [] }) } },
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

const { POST } = await import("@/server/http/stripe/webhook/route");

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

// Max Mode now spends prepaid credits: retiring a legacy meter host must not turn it off.
test("an ended legacy Max Mode meter subscription leaves Max Mode on", async () => {
  expect((await deleteMeterSubscription()).status).toBe(200);
  expect(state.updates).toEqual([]);
});

test("a replaced meter host keeps Max Mode on while meters live elsewhere", async () => {
  state.subscriptions = [{ id: "sub_new_meter", status: "active", items: meteredItems }];
  expect((await deleteMeterSubscription()).status).toBe(200);
  expect(state.updates).toEqual([]);
});

test("an ended monthly plan that hosted legacy meters does not turn Max Mode off", async () => {
  const response = await deliver("customer.subscription.deleted", {
    id: "sub_plan",
    metadata: { userId: "user", organizationId: "team", planId: "pro_team_monthly" },
    items: {
      data: [{ id: "si_plan", price: { lookup_key: "pro_team_monthly" } }, ...meteredItems.data],
    },
  });
  expect(response.status).toBe(200);
  expect(state.updates).not.toContainEqual(expect.objectContaining({ maxModeEnabled: false }));
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
  "a %s legacy meter host leaves prepaid Max Mode alone",
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

function deliverObject(type: string, object: Record<string, unknown>) {
  state.event = { type, data: { object } };
  return POST(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "signature" },
      body: "{}",
    }),
  );
}

test("a paid credit checkout grants Max Mode credits instead of a plan", async () => {
  const { grantMaxModeCreditCheckout } = await import("@/lib/max-mode-credits");
  const session = {
    object: "checkout.session",
    id: "cs_credits",
    mode: "payment",
    payment_status: "paid",
    metadata: { purpose: "max_mode_credits", credits: "10", creditUserId: "user" },
  };
  expect((await deliverObject("checkout.session.completed", session)).status).toBe(200);
  expect(grantMaxModeCreditCheckout).toHaveBeenCalledWith(session);
  expect(state.updates).toEqual([]);
});

test("a succeeded off-session payment is offered to the auto top-up grant", async () => {
  const { grantMaxModeCreditTopUp } = await import("@/lib/max-mode-credits");
  const intent = { object: "payment_intent", id: "pi_top_up", status: "succeeded" };
  expect((await deliverObject("payment_intent.succeeded", intent)).status).toBe(200);
  expect(grantMaxModeCreditTopUp).toHaveBeenCalledWith(intent);
});

test("a refunded charge takes back the credits its payment bought", async () => {
  const { revokeMaxModeCredits } = await import("@/lib/max-mode-credits");
  const charge = { object: "charge", id: "ch_credits", payment_intent: "pi_credits" };
  expect((await deliverObject("charge.refunded", charge)).status).toBe(200);
  expect(revokeMaxModeCredits).toHaveBeenCalledWith("pi_credits");
});
