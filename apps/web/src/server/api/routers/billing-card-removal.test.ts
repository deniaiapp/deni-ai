import { beforeEach, expect, test, vi } from "vitest";
import { billingRouter } from "@/server/api/routers/billing";

const state = vi.hoisted(() => ({
  subscriptions: [] as Record<string, unknown>[],
  invoices: [] as Record<string, unknown>[],
  previewAmountDue: 0,
  updates: [] as Record<string, unknown>[],
  detach: vi.fn(),
  deletionStatus: vi.fn(),
}));
vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/billing-config", () => ({ isBillingDisabled: false }));
vi.mock("@/lib/account-deletion-billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion-billing")>()),
  getAccountDeletionStatus: state.deletionStatus,
}));
vi.mock("@/lib/stripe", () => {
  const iterate = (rows: () => Record<string, unknown>[]) => ({
    async *[Symbol.asyncIterator]() {
      yield* rows();
    },
  });
  return {
    stripe: {
      subscriptions: { list: () => iterate(() => state.subscriptions) },
      invoices: {
        list: () => iterate(() => state.invoices),
        createPreview: async () => ({ amount_due: state.previewAmountDue }),
      },
      customers: { listPaymentMethods: async () => ({ data: [{ id: "pm_card" }] }) },
      paymentMethods: { detach: state.detach },
    },
  };
});

const record = {
  id: "row",
  userId: "user",
  organizationId: null,
  stripeCustomerId: "customer",
  stripeSubscriptionId: "sub",
  planId: "pro_monthly",
  status: "canceled",
  mode: "subscription",
  firstPaidAt: new Date(),
  flashOfferEndsAt: null,
  deletionPending: false,
  paymentMethodFingerprint: "fp_card",
  cardVerifiedAt: new Date(),
};

function caller(userId = "user") {
  return billingRouter.createCaller({
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [record] }) }) }),
      update: () => ({
        set: (updates: Record<string, unknown>) => ({
          where: async () => {
            state.updates.push(updates);
          },
        }),
      }),
    },
    session: { session: { userId }, user: { isAnonymous: false } },
    userId,
  } as never);
}

function subscription(overrides: Record<string, unknown>) {
  return {
    id: "sub",
    customer: "customer",
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: {},
    items: {
      data: [
        {
          current_period_end: 1_900_000_000,
          price: { lookup_key: "pro_monthly", recurring: { usage_type: "licensed" } },
        },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.subscriptions = [];
  state.invoices = [];
  state.previewAmountDue = 0;
  state.updates = [];
  state.detach.mockResolvedValue({});
  state.deletionStatus.mockResolvedValue({ state: "ready", periodEnd: null });
});

test.each([
  [
    "a subscription canceling at period end",
    () => {
      state.subscriptions = [subscription({ cancel_at_period_end: true })];
    },
    "Wait for your subscription to end",
  ],
  [
    "a Max Mode meter subscription with usage left to invoice",
    () => {
      state.subscriptions = [subscription({ metadata: { purpose: "max_mode" } })];
      state.previewAmountDue = 1200;
    },
    "Wait for your subscription to end",
  ],
  [
    "an unpaid invoice",
    () => {
      state.subscriptions = [subscription({ status: "canceled" })];
      state.invoices = [{ id: "in_1", status: "open", amount_remaining: 500 }];
    },
    "Wait for your subscription to end",
  ],
])("cards stay attached while %s can still bill them", async (_, arrange, message) => {
  arrange();
  await expect(caller().removeVerifiedCard()).rejects.toThrow(message);
  expect(state.detach).not.toHaveBeenCalled();
  expect(state.updates).toEqual([]);
});

test("an idle Max Mode meter subscription left after the plan ended does not block removal", async () => {
  state.subscriptions = [
    subscription({ status: "canceled" }),
    subscription({ id: "sub_meter", metadata: { purpose: "max_mode" } }),
  ];

  await expect(caller().removeVerifiedCard()).resolves.toEqual({ removed: true });
  expect(state.detach).toHaveBeenCalledWith("pm_card");
});

test("removing the card keeps its fingerprint so the reuse slot stays taken", async () => {
  state.subscriptions = [subscription({ status: "canceled", cancel_at_period_end: true })];
  state.invoices = [{ id: "in_1", status: "paid", amount_remaining: 0 }];

  await expect(caller().removeVerifiedCard()).resolves.toEqual({ removed: true });

  expect(state.detach).toHaveBeenCalledWith("pm_card");
  const [updates] = state.updates;
  expect(updates).not.toHaveProperty("paymentMethodFingerprint");
  expect(updates).toMatchObject({ cardVerifiedAt: null, cardRemovedAt: expect.any(Date) });
});

test("account deletion status checks are rate limited per user", async () => {
  const userId = "deletion-status-user";
  for (let call = 0; call < 10; call += 1) {
    await caller(userId).accountDeletionStatus();
  }
  await expect(caller(userId).accountDeletionStatus()).rejects.toThrow("Too many requests");
  expect(state.deletionStatus).toHaveBeenCalledTimes(10);
  await expect(caller("another-user").accountDeletionStatus()).resolves.toMatchObject({
    state: "ready",
  });
});
