import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";
import { recordTeamAuditEvent, updateTeamSeatCount } from "@/lib/team-billing";
import { saveTeamBillingRecord } from "@/lib/team-billing-record";

const state = vi.hoisted(() => ({
  event: {} as Record<string, unknown>,
  subscription: {} as Record<string, unknown>,
  customerMetadata: {} as Record<string, string>,
  /** Users that still exist. */
  users: new Set<string>(),
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
  getTeamBilling: vi.fn(async () => ({ status: "active", planId: "pro_team_monthly" })),
  recordTeamAuditEvent: vi.fn(),
  updateTeamSeatCount: vi.fn(),
}));
vi.mock("@/lib/team-billing-record", () => ({
  saveTeamBillingRecord: vi.fn(async () => ({ id: "team-row" })),
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    webhooks: { constructEvent: () => state.event },
    subscriptions: { retrieve: async () => state.subscription },
    customers: { retrieve: async () => ({ id: "cus_team", metadata: state.customerMetadata }) },
  },
}));
vi.mock("@/db/drizzle", () => {
  const dialect = new PgDialect();
  return {
    db: {
      select: () => ({
        from: (table: Parameters<typeof getTableName>[0]) => ({
          where: (condition: SQL) => ({
            limit: async () => {
              if (getTableName(table) !== "user") return [];
              const [id] = dialect.sqlToQuery(condition).params as string[];
              return id && state.users.has(id) ? [{ id }] : [];
            },
          }),
        }),
      }),
    },
  };
});

const { POST } = await import("./route");

function deliver() {
  return POST(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "{}",
    }),
  );
}

function teamSubscription(status: string, metadata: Record<string, string>) {
  return {
    id: "sub_team",
    object: "subscription",
    customer: "cus_team",
    status,
    cancel_at_period_end: false,
    cancel_at: null,
    metadata,
    items: {
      data: [
        {
          id: "si_team",
          quantity: 3,
          current_period_end: 1_900_000_000,
          price: { id: "price_team", lookup_key: "pro_team_monthly" },
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.customerMetadata = { organizationId: "team" };
  state.users = new Set(["admin"]);
});

test("a team payment failure is applied and logged after its payer deleted their account", async () => {
  state.subscription = teamSubscription("past_due", {
    organizationId: "team",
    userId: "deleted-payer",
  });
  state.event = { type: "customer.subscription.updated", data: { object: state.subscription } };

  expect((await deliver()).status).toBe(200);
  // Found by organization: the row is updated without naming the missing user.
  expect(saveTeamBillingRecord).toHaveBeenCalledWith(
    expect.anything(),
    null,
    "team",
    expect.objectContaining({ stripeSubscriptionId: "sub_team", status: "past_due" }),
    undefined,
  );
  // The audit entry's actor would violate its foreign key; it reads as a deleted user.
  expect(recordTeamAuditEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      organizationId: "team",
      actorUserId: null,
      action: "payment_failed",
    }),
  );
});

test("a team cancellation with no user anywhere still clears the team's plan", async () => {
  // Neither Stripe nor the contactless team row names a user.
  state.customerMetadata = { organizationId: "team" };
  state.event = {
    type: "customer.subscription.deleted",
    data: { object: teamSubscription("canceled", { organizationId: "team" }) },
  };

  expect((await deliver()).status).toBe(200);
  expect(saveTeamBillingRecord).toHaveBeenCalledWith(
    expect.anything(),
    null,
    "team",
    expect.objectContaining({ stripeSubscriptionId: null, status: "inactive" }),
    "sub_team",
  );
  expect(recordTeamAuditEvent).toHaveBeenCalledWith(
    expect.objectContaining({ actorUserId: null, action: "subscription_expired" }),
  );
});

test("a completed team checkout whose buyer was deleted is saved without a 500", async () => {
  state.subscription = teamSubscription("active", { organizationId: "team" });
  state.event = {
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_team",
        object: "checkout.session",
        mode: "subscription",
        customer: "cus_team",
        subscription: "sub_team",
        metadata: { organizationId: "team", userId: "deleted-buyer" },
      },
    },
  };

  expect((await deliver()).status).toBe(200);
  expect(saveTeamBillingRecord).toHaveBeenCalledWith(
    expect.anything(),
    null,
    "team",
    expect.objectContaining({ stripeSubscriptionId: "sub_team", status: "active" }),
    undefined,
  );
  expect(updateTeamSeatCount).toHaveBeenCalledWith("team");
  expect(recordTeamAuditEvent).toHaveBeenCalledWith(
    expect.objectContaining({ actorUserId: null, action: "subscription_purchased" }),
  );
});

test("an existing team payer is still credited", async () => {
  state.subscription = teamSubscription("past_due", { organizationId: "team", userId: "admin" });
  state.event = { type: "customer.subscription.updated", data: { object: state.subscription } };

  expect((await deliver()).status).toBe(200);
  expect(saveTeamBillingRecord).toHaveBeenCalledWith(
    expect.anything(),
    "admin",
    "team",
    expect.anything(),
    undefined,
  );
  expect(recordTeamAuditEvent).toHaveBeenCalledWith(
    expect.objectContaining({ actorUserId: "admin", action: "payment_failed" }),
  );
});
