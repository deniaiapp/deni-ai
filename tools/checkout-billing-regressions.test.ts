import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import { billingRouter } from "@/server/api/routers/billing";

const state = vi.hoisted(() => ({
  record: {} as Record<string, unknown>,
  subscriptions: [] as Record<string, unknown>[],
  checkoutSession: {} as Record<string, unknown>,
  completedSessions: [] as Record<string, unknown>[],
  createdSession: vi.fn(),
  expiredSession: vi.fn(),
  couponId: null as string | null,
  couponRedeemed: 0,
  offerSpots: null as number | null,
  duringUpdate: undefined as (() => void) | undefined,
  duringRetrieve: undefined as (() => void) | undefined,
  duringList: undefined as (() => void) | undefined,
}));
vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/billing-config", () => ({ isBillingDisabled: false }));
// The procedure budgets are covered elsewhere; these tests call checkout more often.
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/billing-offers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing-offers")>();
  return {
    ...actual,
    getFlashOfferCouponId: () => state.couponId,
    getFlashOfferLimit: (
      ...[record, timesRedeemed, options]: Parameters<typeof actual.getFlashOfferLimit>
    ) => actual.getFlashOfferLimit(record, timesRedeemed, { spots: state.offerSpots, ...options }),
  };
});
vi.mock("@/lib/billing-card-usage", () => ({
  claimCardVerification: vi.fn(),
  getBillingFingerprintUpdates: async () => ({ paymentMethodFingerprint: null }),
  getCustomerPrimaryCardInfo: async () => ({ fingerprint: null, funding: "unknown" }),
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    prices: {
      list: async ({ lookup_keys }: { lookup_keys: string[] }) => ({
        data: [
          {
            id: `price_${lookup_keys[0]}`,
            lookup_key: lookup_keys[0],
            recurring: { interval: "month" },
          },
        ],
      }),
    },
    coupons: {
      retrieve: async (id: string) => ({
        id,
        valid: true,
        percent_off: 25,
        times_redeemed: state.couponRedeemed,
      }),
    },
    subscriptions: {
      list: async () => {
        state.duringList?.();
        return { data: state.subscriptions };
      },
      update: async () => {
        state.duringUpdate?.();
        return subscription("active", "plus_monthly");
      },
      retrieve: async (id: string) => {
        state.duringRetrieve?.();
        return state.subscriptions.find((sub) => sub.id === id);
      },
    },
    checkout: {
      sessions: {
        create: state.createdSession,
        expire: state.expiredSession,
        retrieve: async (id: string) =>
          state.completedSessions.find((session) => session.id === id) ?? state.checkoutSession,
        list: async () => ({ data: state.completedSessions }),
      },
    },
  },
}));

function matchesSnapshot(condition?: SQL) {
  if (!condition) return true;
  const query = new PgDialect().sqlToQuery(condition);
  for (const match of query.sql.matchAll(/"([a-z_]+)" IS NOT DISTINCT FROM \$(\d+)/g)) {
    const key = match[1].replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    const actual = state.record[key] ?? null;
    const expected = query.params[Number(match[2]) - 1] ?? null;
    if (
      actual instanceof Date
        ? actual.getTime() !== new Date(expected as string).getTime()
        : actual !== expected
    )
      return false;
  }
  return true;
}
function database() {
  const apply = (updates: Record<string, unknown>) => {
    Object.assign(state.record, updates);
    return [{ ...state.record }];
  };
  const database = {
    execute: async () => {},
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        let joined = false;
        const query = {
          // Joined billing reads are team plans; these tests cover personal billing.
          innerJoin: () => {
            joined = true;
            return query;
          },
          where: () => {
            const rows = getTableName(table) === "billing" && !joined ? [{ ...state.record }] : [];
            const result = Promise.resolve(rows);
            return Object.assign(result, { limit: () => result });
          },
        };
        return query;
      },
    }),
    // Every test starts with an existing personal row, so upserts take the update path.
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: ({
          set,
          setWhere,
        }: {
          set: Record<string, unknown>;
          setWhere?: SQL;
        }) => ({
          returning: async () => (matchesSnapshot(setWhere) ? apply(set) : []),
        }),
      }),
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => ({
        where: (condition: SQL) => {
          const result = Promise.resolve().then(() =>
            matchesSnapshot(condition) ? apply(updates) : [],
          );
          return Object.assign(result, { returning: () => result });
        },
      }),
    }),
    transaction: async (run: (transaction: unknown) => Promise<unknown>) => run(database),
  };
  return database;
}

function caller() {
  return billingRouter.createCaller({
    db: database(),
    session: { session: { userId: "user" }, user: { isAnonymous: false, emailVerified: true } },
    userId: "user",
  } as never);
}

function subscription(status: string, lookupKey: string, planId = lookupKey) {
  return {
    id: "sub",
    customer: "customer",
    status,
    metadata: { planId },
    cancel_at: null,
    cancel_at_period_end: false,
    items: {
      data: [
        {
          id: "item",
          current_period_end: 1_900_000_000,
          price: { id: `price_${lookupKey}`, lookup_key: lookupKey, recurring: {} },
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.record = {
    id: "row",
    userId: "user",
    stripeCustomerId: "customer",
    stripeSubscriptionId: "sub",
    planId: "plus_monthly",
    priceId: "price_plus_monthly",
    status: "active",
    mode: "subscription",
    firstPaidAt: new Date(),
    flashOfferEndsAt: new Date(),
    checkoutSessionId: null,
  };
  state.subscriptions = [subscription("active", "plus_monthly")];
  state.completedSessions = [];
  state.checkoutSession = {};
  state.createdSession.mockResolvedValue({ id: "cs_new", client_secret: "secret" });
  state.expiredSession.mockResolvedValue({});
  state.couponId = null;
  state.couponRedeemed = 0;
  state.offerSpots = null;
  state.duringUpdate = undefined;
  state.duringRetrieve = undefined;
  state.duringList = undefined;
});

test("clients cannot replay a checkout session into the plan", () => {
  // Line items keep the price a session was opened with, so replaying an old
  // session after a downgrade restored the higher plan. Only the webhook and the
  // live-subscription sync record purchases.
  expect(Object.keys(billingRouter._def.procedures)).not.toContain("confirmCheckout");
});

function openSession(metadata: Record<string, string>) {
  return {
    id: "cs_old",
    status: "open",
    ui_mode: "elements",
    client_reference_id: "user",
    client_secret: "old_secret",
    metadata: { userId: "user", ...metadata },
  };
}

const freeRecord = {
  stripeSubscriptionId: null,
  planId: null,
  priceId: null,
  status: "inactive",
  checkoutSessionId: "cs_old",
};

test("opening checkout does not touch the current plan", async () => {
  Object.assign(state.record, freeRecord, { checkoutSessionId: null });
  state.subscriptions = [];
  await caller().createCheckoutSession({ planId: "go_monthly" });
  expect(state.record).toMatchObject({ ...freeRecord, checkoutSessionId: "cs_new" });
});

test("a stored open session is not handed back once a guard refuses checkout", async () => {
  state.record.checkoutSessionId = "cs_old";
  state.checkoutSession = openSession({
    planId: "go_monthly",
    priceId: "price_go_monthly",
    flashOfferCoupon: "none",
  });
  await expect(caller().createCheckoutSession({ planId: "go_monthly" })).rejects.toThrow(
    "You already have an active subscription",
  );
  expect(state.createdSession).not.toHaveBeenCalled();
});

test("a subscription that ended after canceling at period end allows a new checkout", async () => {
  Object.assign(state.record, freeRecord, { checkoutSessionId: null });
  state.subscriptions = [
    { ...subscription("canceled", "plus_monthly"), cancel_at_period_end: true },
  ];
  await expect(caller().createCheckoutSession({ planId: "go_monthly" })).resolves.toMatchObject({
    sessionId: "cs_new",
  });
});

test("a matching open session is reused", async () => {
  Object.assign(state.record, freeRecord);
  state.subscriptions = [];
  state.checkoutSession = openSession({
    planId: "plus_yearly",
    priceId: "price_plus_yearly",
    flashOfferCoupon: "none",
  });
  await expect(caller().createCheckoutSession({ planId: "plus_yearly" })).resolves.toEqual({
    sessionId: "cs_old",
    clientSecret: "old_secret",
  });
  expect(state.createdSession).not.toHaveBeenCalled();
  expect(state.expiredSession).not.toHaveBeenCalled();
});

test.each([
  ["a flash offer granted after it was opened", "none", "coupon_flash"],
  ["an ended flash offer", "coupon_flash", null],
])("an open session from before %s is expired and replaced", async (_, stored, current) => {
  Object.assign(state.record, freeRecord, { flashOfferEndsAt: new Date(Date.now() + 60_000) });
  state.subscriptions = [];
  state.couponId = current;
  if (!current) state.record.flashOfferEndsAt = new Date(Date.now() - 60_000);
  state.checkoutSession = openSession({
    planId: "plus_yearly",
    priceId: "price_plus_yearly",
    flashOfferCoupon: stored,
  });

  await expect(caller().createCheckoutSession({ planId: "plus_yearly" })).resolves.toMatchObject({
    sessionId: "cs_new",
  });

  expect(state.expiredSession).toHaveBeenCalledWith("cs_old", {}, expect.anything());
  const [params] = state.createdSession.mock.calls[0];
  expect(params.discounts).toEqual(current ? [{ coupon: current }] : undefined);
  expect(params.metadata).toMatchObject({ flashOfferCoupon: current ?? "none" });
  expect(state.record.checkoutSessionId).toBe("cs_new");
});

test.each([
  ["while spots are open, a never-paid account gets the offer without a timer", 1, null, true],
  ["once every spot is taken, checkout is full price", 2, null, false],
  ["an account that paid before gets no spot", 0, new Date(), false],
])("%s", async (_, redeemed, firstPaidAt, discounted) => {
  Object.assign(state.record, freeRecord, {
    checkoutSessionId: null,
    firstPaidAt,
    flashOfferEndsAt: new Date(Date.now() - 60_000),
  });
  state.subscriptions = [];
  state.couponId = "coupon_flash";
  state.offerSpots = 2;
  state.couponRedeemed = redeemed;

  await caller().createCheckoutSession({ planId: "plus_yearly" });

  const [params] = state.createdSession.mock.calls[0];
  expect(params.discounts).toEqual(discounted ? [{ coupon: "coupon_flash" }] : undefined);
  expect(params.allow_promotion_codes).toBe(discounted ? undefined : true);
});

test("an open session for another plan is expired before a new one is created", async () => {
  Object.assign(state.record, freeRecord);
  state.subscriptions = [];
  state.checkoutSession = openSession({
    planId: "pro_monthly",
    priceId: "price_pro_monthly",
    flashOfferCoupon: "none",
  });
  await caller().createCheckoutSession({ planId: "plus_monthly" });
  expect(state.expiredSession).toHaveBeenCalledWith("cs_old", {}, expect.anything());
  expect(state.createdSession).toHaveBeenCalledTimes(1);
});

test("the billed price decides the plan, not stale subscription metadata", async () => {
  state.subscriptions = [subscription("active", "plus_monthly", "go_monthly")];
  await caller().status();
  expect(state.record.planId).toBe("plus_monthly");
});

test("a slow status query cannot overwrite a newly activated subscription", async () => {
  state.subscriptions = [subscription("canceled", "plus_monthly")];
  state.duringRetrieve = () =>
    Object.assign(state.record, {
      stripeSubscriptionId: "sub_new",
      planId: "go_monthly",
      status: "active",
    });
  await caller().status();
  expect(state.record).toMatchObject({
    stripeSubscriptionId: "sub_new",
    planId: "go_monthly",
    status: "active",
  });
});
test("an empty stale Stripe list cannot clear a concurrently purchased plan", async () => {
  state.subscriptions = [];
  state.duringList = () =>
    Object.assign(state.record, {
      stripeSubscriptionId: "sub_new",
      planId: "go_monthly",
      status: "active",
    });
  await caller().status();
  expect(state.record.stripeSubscriptionId).toBe("sub_new");
});
test("a stale snapshot cannot revert a plan change on the same subscription", async () => {
  state.duringRetrieve = () =>
    Object.assign(state.record, { priceId: "price_go_monthly", planId: "go_monthly" });
  await caller().status();
  expect(state.record.planId).toBe("go_monthly");
});
test.each(["cancelSubscription", "resumeSubscription"] as const)(
  "a delayed %s write cannot overwrite a new subscription",
  async (action) => {
    state.duringUpdate = () =>
      Object.assign(state.record, {
        stripeSubscriptionId: "sub_new",
        planId: "go_monthly",
        status: "active",
      });
    await caller()[action]();
    expect(state.record.stripeSubscriptionId).toBe("sub_new");
    expect(state.record.planId).toBe("go_monthly");
  },
);

test("deletion freeze blocks starting another checkout", async () => {
  state.record.deletionPending = true;
  await expect(caller().createCheckoutSession({ planId: "go_monthly" })).rejects.toThrow(
    "Account deletion",
  );
  expect(state.createdSession).not.toHaveBeenCalled();
});
