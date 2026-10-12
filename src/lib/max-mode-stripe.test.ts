import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";
import { attachMaxModeMeteredItems } from "./max-mode-stripe";
import { stripe } from "./stripe";

type Item = { id: string; price: { id: string; lookup_key: string; recurring?: unknown } };
type Subscription = {
  id: string;
  created: number;
  status: string;
  currency: string;
  metadata: Record<string, string>;
  default_payment_method: string | null;
  items: { data: Item[] };
};

const state = vi.hoisted(() => ({
  subscriptions: [] as Subscription[],
  created: 0,
  locks: [] as string[],
}));

const prices = {
  price_basic: { id: "price_basic", lookup_key: "max_mode_basic_month", currency: "usd" },
  price_premium: { id: "price_premium", lookup_key: "max_mode_premium_month", currency: "usd" },
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const copy = (subscription: Subscription) => structuredClone(subscription);
const find = (id: string) => {
  const subscription = state.subscriptions.find((candidate) => candidate.id === id);
  if (!subscription)
    throw Object.assign(new Error("No such subscription"), { code: "resource_missing" });
  return subscription;
};

vi.mock("./billing-config", () => ({ isBillingDisabled: false }));
vi.mock("./stripe", () => ({
  stripe: {
    prices: {
      list: async () => {
        await tick();
        return { data: Object.values(prices) };
      },
    },
    subscriptions: {
      retrieve: async (id: string) => {
        await tick();
        return copy(find(id));
      },
      list: async () => {
        await tick();
        return { data: state.subscriptions.map(copy), has_more: false };
      },
      create: vi.fn(
        async (params: {
          currency: string;
          items: { price: keyof typeof prices }[];
          metadata: Record<string, string>;
          default_payment_method?: string;
        }) => {
          await tick();
          const id = `sub_host_${++state.created}`;
          const subscription: Subscription = {
            id,
            created: 100 + state.created,
            status: "active",
            currency: params.currency,
            metadata: params.metadata,
            default_payment_method: params.default_payment_method ?? null,
            items: {
              data: params.items.map((item, index) => ({
                id: `${id}_item_${index}`,
                price: prices[item.price],
              })),
            },
          };
          state.subscriptions.push(subscription);
          return copy(subscription);
        },
      ),
      update: vi.fn(async (id: string, params: Partial<Subscription>) => {
        Object.assign(find(id), params);
        return copy(find(id));
      }),
      cancel: vi.fn(async (id: string) => {
        find(id).status = "canceled";
        return copy(find(id));
      }),
    },
    subscriptionItems: {
      create: vi.fn(),
      del: vi.fn(),
    },
  },
}));
vi.mock("@/db/drizzle", () => {
  let tail = Promise.resolve();
  return {
    db: {
      transaction: async (run: (transaction: unknown) => Promise<unknown>) => {
        let release: (() => void) | undefined;
        const transaction = {
          execute: async (statement: SQL) => {
            const query = new PgDialect().sqlToQuery(statement);
            expect(query.sql).toContain("pg_advisory_xact_lock");
            state.locks.push(String(query.params[0]));
            const previous = tail;
            tail = new Promise<void>((resolve) => {
              release = resolve;
            });
            await previous;
          },
          update: () => ({ set: () => ({ where: async () => {} }) }),
        };
        try {
          return await run(transaction);
        } finally {
          release?.();
        }
      },
    },
  };
});

function planSubscription(id: string, interval: "month" | "year"): Subscription {
  return {
    id,
    created: 1,
    status: "active",
    currency: "usd",
    metadata: { userId: "user", planId: `pro_${interval}ly` },
    default_payment_method: "pm_card",
    items: {
      data: [
        {
          id: `${id}_licensed`,
          price: {
            id: `price_pro_${interval}`,
            lookup_key: `pro_${interval}ly`,
            recurring: { interval },
          },
        },
      ],
    },
  };
}

function meterHost(
  id: string,
  created: number,
  overrides: Partial<Subscription> = {},
): Subscription {
  return {
    id,
    created,
    status: "active",
    currency: "usd",
    metadata: { purpose: "max_mode", userId: "user" },
    default_payment_method: "pm_card",
    items: {
      data: [
        { id: `${id}_basic`, price: prices.price_basic },
        { id: `${id}_premium`, price: prices.price_premium },
      ],
    },
    ...overrides,
  };
}

const record = (stripeSubscriptionId: string) => ({
  id: "billing",
  stripeCustomerId: "customer",
  stripeSubscriptionId,
  stripeMeteredBasicItemId: null,
  stripeMeteredPremiumItemId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.subscriptions = [];
  state.created = 0;
  state.locks = [];
});

test("concurrent enables on a yearly plan create a single meter host charged to the plan's card", async () => {
  state.subscriptions = [planSubscription("sub_year", "year")];

  const results = await Promise.all([
    attachMaxModeMeteredItems(record("sub_year"), "user"),
    attachMaxModeMeteredItems(record("sub_year"), "user"),
  ]);

  expect(state.locks).toEqual(["max-mode-host:customer", "max-mode-host:customer"]);
  expect(stripe.subscriptions.create).toHaveBeenCalledTimes(1);
  expect(stripe.subscriptions.create).toHaveBeenCalledWith(
    expect.objectContaining({ default_payment_method: "pm_card" }),
  );
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({ ok: true, subscriptionId: "sub_year" });
});

test("duplicate same-currency hosts are dropped without billing their usage twice", async () => {
  state.subscriptions = [
    planSubscription("sub_year", "year"),
    meterHost("sub_newer", 30),
    meterHost("sub_oldest", 20),
    meterHost("sub_jpy", 40, { currency: "jpy" }),
  ];

  const result = await attachMaxModeMeteredItems(record("sub_year"), "user");

  expect(result).toMatchObject({ ok: true, basicItemId: "sub_oldest_basic" });
  expect(stripe.subscriptions.create).not.toHaveBeenCalled();
  expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_newer", {
    prorate: false,
    invoice_now: false,
  });
  // A host in another currency carries usage the kept host never billed.
  expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_jpy", {
    prorate: true,
    invoice_now: true,
  });
});

test("moving the meters to a monthly plan invoices the old host's accrued usage", async () => {
  state.subscriptions = [planSubscription("sub_month", "month"), meterHost("sub_old_host", 20)];
  vi.mocked(stripe.subscriptionItems.create).mockImplementation(
    async (params) => ({ id: `${params?.price}_on_plan` }) as never,
  );

  const result = await attachMaxModeMeteredItems(record("sub_month"), "user");

  expect(result).toMatchObject({ ok: true, subscriptionId: "sub_month" });
  expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_old_host", {
    prorate: true,
    invoice_now: true,
  });
});

test("an existing host without a payment method gets the plan's card", async () => {
  state.subscriptions = [
    planSubscription("sub_year", "year"),
    meterHost("sub_host", 20, { default_payment_method: null }),
  ];

  expect(await attachMaxModeMeteredItems(record("sub_year"), "user")).toMatchObject({ ok: true });
  expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_host", {
    default_payment_method: "pm_card",
  });
});

test.each(["past_due", "unpaid"])(
  "a %s meter host blocks enabling Max Mode again",
  async (status) => {
    state.subscriptions = [
      planSubscription("sub_year", "year"),
      meterHost("sub_host", 20, { status }),
    ];

    const result = await attachMaxModeMeteredItems(record("sub_year"), "user");

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("unpaid") });
    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  },
);
