import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";
import {
  cancelPersonalSubscription,
  cancelOrgMembersPersonalSubscriptions,
  cancelTeamSubscriptionForDeletion,
  updateTeamSeatCount,
} from "./team-billing";
import { stripe } from "./stripe";

const state = vi.hoisted(() => ({
  team: null as Record<string, unknown> | null,
  membership: true,
  memberCount: 2,
  liveTeamStatus: "active",
  licensed: true,
  teamError: false,
  personalSchedule: null as string | null,
  teamSchedule: null as string | null,
  personalQuantity: 2,
  updates: 0,
  deletes: 0,
}));
vi.mock("./billing-config", () => ({ isBillingDisabled: false }));
vi.mock("./stripe", () => ({
  stripe: {
    subscriptions: { retrieve: vi.fn(), cancel: vi.fn(), update: vi.fn() },
    subscriptionSchedules: {
      release: vi.fn(async () => ({})),
      retrieve: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("./stripe-subscriptions", () => ({
  getLicensedSubscriptionItem: (subscription: { items: { data: unknown[] } }) =>
    subscription.items.data[0],
  isMeteredMaxModePrice: () => false,
}));
vi.mock("@/db/drizzle", () => {
  const db = {
    execute: async () => {},
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => ({
        where: (condition: SQL) => {
          const { params } = new PgDialect().sqlToQuery(condition);
          const rows =
            getTableName(table) === "member"
              ? state.membership
                ? [{ id: "member", userId: "user", count: state.memberCount }]
                : []
              : params.includes("team")
                ? state.team
                  ? [state.team]
                  : []
                : [{ stripeSubscriptionId: "personal-sub" }];
          const result = Promise.resolve(rows);
          return Object.assign(result, {
            limit: () => result,
            orderBy: () => ({ limit: () => result }),
          });
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          state.updates++;
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        state.deletes++;
      },
    }),
    transaction: async (run: (transaction: unknown) => Promise<unknown>) => run(db),
  };
  return { db };
});

beforeEach(() => {
  vi.clearAllMocks();
  state.team = { stripeSubscriptionId: "team-sub", planId: "pro_team_monthly" };
  state.membership = true;
  state.memberCount = 2;
  state.liveTeamStatus = "active";
  state.licensed = true;
  state.teamError = false;
  state.personalSchedule = null;
  state.teamSchedule = null;
  state.personalQuantity = 2;
  state.updates = 0;
  state.deletes = 0;
  vi.mocked(stripe.subscriptions.retrieve).mockImplementation(async (id) => {
    if (id === "team-sub" && state.teamError) throw new Error("Stripe unavailable");
    return {
      id,
      status: id === "team-sub" ? state.liveTeamStatus : "active",
      schedule: id === "team-sub" ? state.teamSchedule : state.personalSchedule,
      items: {
        data: state.licensed
          ? [
              {
                id: "licensed",
                quantity: id === "team-sub" ? state.memberCount : state.personalQuantity,
                price: { id: "team-price", lookup_key: "pro_team_monthly" },
              },
            ]
          : [],
      },
    } as never;
  });
});

test("joining a free organization leaves the personal subscription untouched", async () => {
  state.team = null;
  await cancelPersonalSubscription("user", "team");
  expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  expect(state.updates).toBe(0);
});

test.each(["incomplete", "canceled", "unpaid", "paused", "incomplete_expired"])(
  "a %s team subscription cannot cancel the personal plan",
  async (status) => {
    state.liveTeamStatus = status;
    await cancelPersonalSubscription("user", "team");
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  },
);

test.each(["active", "trialing", "past_due"])(
  "a %s licensed team plan can replace the personal plan",
  async (status) => {
    state.liveTeamStatus = status;
    await cancelPersonalSubscription("user", "team");
    // The final invoice bills Max Mode overage metered on a monthly personal plan.
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("personal-sub", {
      prorate: true,
      invoice_now: true,
    });
    expect(state.updates).toBe(1);
  },
);

test("non-members and metered-only subscriptions cannot cancel a personal plan", async () => {
  state.membership = false;
  await cancelPersonalSubscription("user", "team");
  expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  state.membership = true;
  state.licensed = false;
  await cancelPersonalSubscription("user", "team");
  expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
});

test("Stripe verification failures preserve the personal subscription", async () => {
  state.teamError = true;
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await cancelPersonalSubscription("user", "team");
  expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  expect(state.updates).toBe(0);
  log.mockRestore();
});

test("bulk team activation also checks the destination team", async () => {
  state.team = null;
  await cancelOrgMembersPersonalSubscriptions("team");
  expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
});

test("cancelling a personal subscription on team join releases an attached schedule first", async () => {
  state.personalSchedule = "sched_personal";
  await cancelPersonalSubscription("user", "team");
  expect(stripe.subscriptionSchedules.release).toHaveBeenCalledWith("sched_personal");
  expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("personal-sub", {
    prorate: true,
    invoice_now: true,
  });
  const releaseOrder = vi.mocked(stripe.subscriptionSchedules.release).mock.invocationCallOrder[0]!;
  const cancelOrder = vi.mocked(stripe.subscriptions.cancel).mock.invocationCallOrder[0]!;
  expect(releaseOrder).toBeLessThan(cancelOrder);
});

test("cancelling a team subscription for org deletion releases an attached schedule first", async () => {
  state.teamSchedule = "sched_team";
  await cancelTeamSubscriptionForDeletion("team");
  expect(stripe.subscriptionSchedules.release).toHaveBeenCalledWith("sched_team");
  expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("team-sub", {
    prorate: true,
    invoice_now: true,
  });
  const releaseOrder = vi.mocked(stripe.subscriptionSchedules.release).mock.invocationCallOrder[0]!;
  const cancelOrder = vi.mocked(stripe.subscriptions.cancel).mock.invocationCallOrder[0]!;
  expect(releaseOrder).toBeLessThan(cancelOrder);
  expect(state.deletes).toBe(1);
});

test("updateTeamSeatCount still syncs the scheduled seat count when the subscription quantity already matches", async () => {
  state.teamSchedule = "sched_team";
  vi.mocked(stripe.subscriptionSchedules.retrieve).mockResolvedValue({
    id: "sched_team",
    status: "active",
    current_phase: { start_date: 1_897_408_000, end_date: 1_900_000_000 },
    phases: [
      {
        start_date: 1_897_408_000,
        end_date: 1_900_000_000,
        items: [{ price: { id: "team-price", lookup_key: "pro_team_monthly" }, quantity: 1 }],
        discounts: [],
      },
    ],
  } as never);

  await updateTeamSeatCount("team");

  expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  expect(stripe.subscriptionSchedules.retrieve).toHaveBeenCalledWith("sched_team", {
    expand: ["phases.items.price"],
  });
  expect(stripe.subscriptionSchedules.update).toHaveBeenCalledWith(
    "sched_team",
    expect.objectContaining({
      phases: [
        expect.objectContaining({
          items: [{ price: "team-price", quantity: 2 }],
        }),
      ],
    }),
  );
});
