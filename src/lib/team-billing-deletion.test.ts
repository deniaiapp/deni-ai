import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  statuses: {} as Record<string, string>,
  /** Team billing rows; defaults to one row per subscription in `statuses`. */
  records: null as Record<string, unknown>[] | null,
  /** Subscription hosting each Max Mode meter item. */
  meterItems: {} as Record<string, string>,
  cancelError: null as Error | null,
  deleted: false,
}));

vi.mock("./billing-config", () => ({ isBillingDisabled: false }));
vi.mock("./stripe", () => ({
  stripe: {
    subscriptions: {
      retrieve: vi.fn(async (id: string) => ({ id, status: state.statuses[id] })),
      cancel: vi.fn(async (id: string) => {
        if (state.cancelError) throw state.cancelError;
        return { id, status: "canceled" };
      }),
    },
    subscriptionItems: {
      retrieve: vi.fn(async (id: string) => {
        const subscription = state.meterItems[id];
        if (!subscription)
          throw Object.assign(new Error("No such item"), { code: "resource_missing" });
        return { id, subscription };
      }),
    },
  },
}));
vi.mock("@/db/drizzle", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () =>
          state.records ??
          Object.keys(state.statuses).map((stripeSubscriptionId) => ({ stripeSubscriptionId })),
      }),
    }),
    delete: () => ({
      where: async () => {
        state.deleted = true;
      },
    }),
  },
}));

const { cancelTeamSubscriptionForDeletion } = await import("./team-billing");
const { stripe } = await import("./stripe");

beforeEach(() => {
  vi.clearAllMocks();
  state.statuses = {};
  state.records = null;
  state.meterItems = {};
  state.cancelError = null;
  state.deleted = false;
});

test.each(["unpaid", "paused", "incomplete", "active", "trialing", "past_due"])(
  "cancels a %s team subscription before the organization is deleted",
  async (status) => {
    state.statuses = { sub_team: status };
    await cancelTeamSubscriptionForDeletion("org");
    // A monthly plan can host the team's Max Mode meters: invoice the accrued usage.
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_team", {
      prorate: true,
      invoice_now: true,
    });
    expect(state.deleted).toBe(true);
  },
);

test.each(["canceled", "incomplete_expired"])("skips an ended %s subscription", async (status) => {
  state.statuses = { sub_team: status };
  await cancelTeamSubscriptionForDeletion("org");
  expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  expect(state.deleted).toBe(true);
});

test("a failed cancellation blocks deletion and keeps the billing rows", async () => {
  state.statuses = { sub_team: "unpaid" };
  state.cancelError = new Error("Stripe unavailable");
  await expect(cancelTeamSubscriptionForDeletion("org")).rejects.toThrow("Stripe unavailable");
  expect(state.deleted).toBe(false);
});

test("a yearly team's separate Max Mode meter subscription is invoiced and cancelled", async () => {
  state.statuses = { sub_team: "active", sub_meter: "active" };
  state.records = [
    {
      stripeSubscriptionId: "sub_team",
      stripeMeteredBasicItemId: "si_basic",
      stripeMeteredPremiumItemId: "si_premium",
    },
  ];
  state.meterItems = { si_basic: "sub_meter", si_premium: "sub_meter" };
  await cancelTeamSubscriptionForDeletion("org");
  expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(2);
  expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_meter", {
    prorate: true,
    invoice_now: true,
  });
  expect(state.deleted).toBe(true);
});

test("a meter item that no longer exists does not block deletion", async () => {
  state.statuses = { sub_team: "active" };
  state.records = [{ stripeSubscriptionId: "sub_team", stripeMeteredBasicItemId: "si_gone" }];
  await cancelTeamSubscriptionForDeletion("org");
  expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  expect(state.deleted).toBe(true);
});
