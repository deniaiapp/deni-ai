import { beforeEach, expect, test, vi } from "vitest";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  record: {} as Record<string, unknown>,
  event: {} as Record<string, unknown>,
  /** What Stripe returns when the webhook reads the subscription; defaults to the event's own copy. */
  currentSubscription: null as Record<string, unknown> | null,
}));
vi.mock("@/env", () => ({
  env: { STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec_test" },
}));
vi.mock("@/lib/billing-card-usage", () => ({
  getBillingFingerprintUpdates: async () => ({ paymentMethodFingerprint: "fp" }),
}));
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
    customers: { retrieve: async () => ({ metadata: { userId: "user" } }) },
    // The webhook reads the live subscription instead of trusting the event's snapshot.
    subscriptions: {
      retrieve: async () =>
        state.currentSubscription ?? (state.event.data as { object: unknown }).object,
    },
  },
}));
vi.mock("@/db/drizzle", () => {
  const matches = (condition?: SQL) => {
    if (!condition) return true;
    const query = new PgDialect().sqlToQuery(condition);
    for (const match of query.sql.matchAll(/"([a-z_]+)" (?:IS NOT DISTINCT FROM|=) \$(\d+)/g)) {
      const key = match[1].replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      const actual = state.record[key] ?? null;
      const expected = query.params[Number(match[2]) - 1] ?? null;
      if (actual instanceof Date ? actual.toISOString() !== expected : actual !== expected)
        return false;
    }
    return true;
  };
  const result = (rows: unknown[]) => {
    const promise = Promise.resolve(rows);
    return Object.assign(promise, { limit: () => promise });
  };
  return {
    db: {
      transaction: async (run: (tx: unknown) => Promise<unknown>) =>
        run((await import("@/db/drizzle")).db),
      execute: async () => {},
      update: () => ({
        set: (updates: Record<string, unknown>) => ({
          where: (condition: SQL) => {
            const applied = Promise.resolve().then(() => {
              if (!matches(condition)) return [];
              Object.assign(state.record, updates);
              return [{ ...state.record }];
            });
            return Object.assign(applied, { returning: () => applied });
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: (condition?: SQL) => result(matches(condition) ? [{ ...state.record }] : []),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: ({
            set,
            setWhere,
          }: {
            set: Record<string, unknown>;
            setWhere?: SQL;
          }) => {
            const applied = Promise.resolve().then(() => {
              if (!matches(setWhere)) return [];
              Object.assign(state.record, set);
              return [state.record];
            });
            return Object.assign(applied, { returning: () => applied });
          },
        }),
      }),
    },
  };
});

const { POST } = await import("../src/server/http/stripe/webhook/route");

function deliver() {
  return POST(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "{}",
    }),
  );
}

const paidLifetimeSession = {
  id: "cs_lifetime",
  object: "checkout.session",
  mode: "payment",
  payment_status: "paid",
  customer: "customer",
  client_reference_id: "user",
  metadata: { userId: "user", planId: "pro_lifetime" },
  payment_intent: {
    metadata: { priceId: "price_pro_lifetime" },
    latest_charge: { refunded: false, disputed: false },
  },
};

beforeEach(() => {
  state.record = {
    userId: "user",
    stripeCustomerId: "customer",
    stripeSubscriptionId: null,
    planId: null,
    status: "inactive",
    mode: "subscription",
    firstPaidAt: null,
  };
  state.currentSubscription = null;
});

test("an old deletion cannot clear a replacement subscription", async () => {
  Object.assign(state.record, {
    stripeSubscriptionId: "sub_new",
    planId: "go_monthly",
    status: "active",
    mode: "subscription",
  });
  state.event = {
    type: "customer.subscription.deleted",
    data: {
      object: {
        object: "subscription",
        id: "sub_old",
        customer: "customer",
        metadata: { userId: "user" },
        items: { data: [] },
      },
    },
  };
  expect((await deliver()).status).toBe(200);
  expect(state.record).toMatchObject({
    stripeSubscriptionId: "sub_new",
    planId: "go_monthly",
    status: "active",
  });
});

// Pro Lifetime was removed: a one-time checkout naming it must not grant a plan.
test("a paid one-time checkout for the removed lifetime plan grants nothing", async () => {
  state.event = { type: "checkout.session.completed", data: { object: paidLifetimeSession } };
  expect((await deliver()).status).toBe(200);
  expect(state.record).toMatchObject({ planId: null, status: "inactive" });
});

test("a stale subscription event cannot undo a newer cancellation", async () => {
  const subscription = {
    id: "sub",
    object: "subscription",
    customer: "customer",
    metadata: { userId: "user", planId: "go_monthly" },
    items: {
      data: [{ current_period_end: 1_900_000_000, price: { lookup_key: "go_monthly" } }],
    },
  };
  Object.assign(state.record, { stripeSubscriptionId: "sub", planId: "go_monthly" });
  // The delayed event still says active; Stripe already knows the subscription ended.
  state.event = {
    type: "customer.subscription.updated",
    data: { object: { ...subscription, status: "active" } },
  };
  state.currentSubscription = { ...subscription, status: "canceled" };

  expect((await deliver()).status).toBe(200);
  expect(state.record).toMatchObject({ status: "inactive" });
});
