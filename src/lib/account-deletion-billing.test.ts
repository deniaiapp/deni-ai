import { getTableName, type SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";
import { billing } from "@/db/schema";
import {
  deletePersonalBillingRecords,
  deletePersonalStripeCustomers,
  getAccountDeletionStatus,
  takeDetachedTeamBillingContacts,
} from "./account-deletion-billing";
import { stripe } from "./stripe";

const state = vi.hoisted(() => ({
  metered: false,
  pendingUsage: false,
  pendingMeter: false,
  unpaid: false,
  canceled: false,
  frozen: false,
  race: false,
  teamOwner: false,
  teamContact: false,
  /** A database still on the old NOT NULL / ON DELETE CASCADE `billing.user_id`. */
  oldSchema: false,
  deleted: [] as { table: string; condition: unknown }[],
  detached: [] as { values: Record<string, unknown>; condition: unknown }[],
}));
vi.mock("@/env", () => ({ env: { STRIPE_SECRET_KEY: "test" } }));
vi.mock("@/db/drizzle", () => {
  const select = () => ({
    from: (table: Parameters<typeof getTableName>[0]) => ({
      where: () => {
        const name = getTableName(table);
        const rows =
          name === "usage_reservation" && state.pendingUsage
            ? [{ id: "pending" }]
            : name === "max_mode_meter_event" && state.pendingMeter
              ? [{ id: "meter" }]
              : name === "member" && state.teamOwner
                ? [{ id: "membership" }]
                : // The team billing rows that still name this user as their contact.
                  name === "billing" && state.teamContact
                  ? [{ customerId: "team-customer" }]
                  : [];
        const result = Promise.resolve(rows);
        return Object.assign(result, {
          limit: async () => (name === "billing" ? [{ customerId: "customer" }] : rows),
        });
      },
    }),
  });
  return {
    db: {
      select,
      delete: (table: Parameters<typeof getTableName>[0]) => ({
        where: async (condition: unknown) => {
          state.deleted.push({ table: getTableName(table), condition });
        },
      }),
      transaction: async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          select,
          execute: async () => {
            if (state.race) state.pendingUsage = true;
          },
          update: () => ({
            set: (values: Record<string, unknown>) => ({
              where: (condition: unknown) => {
                const applied = Promise.resolve().then(() => {
                  if (!("userId" in values)) {
                    state.frozen = true;
                    return [];
                  }
                  // The team billing rows that still name this user as their contact.
                  if (!state.teamContact) return [];
                  if (state.oldSchema) throw new Error('null value in column "user_id"');
                  state.detached.push({ values, condition });
                  return [{ organizationId: "team" }];
                });
                return Object.assign(applied, { returning: () => applied });
              },
            }),
          }),
        }),
    },
  };
});
vi.mock("./stripe", () => ({
  stripe: {
    customers: {
      retrieve: async () => ({ id: "customer", metadata: { userId: "user" } }),
      search: vi.fn(async () => ({ data: [] })),
      del: vi.fn(async () => {
        expect(state.frozen).toBe(true);
        return {};
      }),
    },
    subscriptions: {
      list: ({ customer }: { customer: string }) => ({
        async *[Symbol.asyncIterator]() {
          if (customer === "team-customer") {
            // The team keeps paying after its former owner leaves.
            yield {
              id: "team-subscription",
              status: "active",
              cancel_at_period_end: false,
              cancel_at: null,
              items: { data: [{ price: { recurring: { usage_type: "licensed" } } }] },
            };
            return;
          }
          yield {
            id: "subscription",
            status: state.canceled ? "canceled" : "active",
            cancel_at_period_end: true,
            cancel_at: null,
            items: {
              data: [
                {
                  price: { recurring: { usage_type: state.metered ? "metered" : "licensed" } },
                  current_period_end: 1_900_000_000,
                },
              ],
            },
          };
        },
      }),
      cancel: vi.fn(async () => {
        expect(state.frozen).toBe(true);
        state.canceled = true;
        return {};
      }),
    },
    invoices: {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          if (state.unpaid) yield { id: "invoice", status: "open", amount_remaining: 100 };
        },
      }),
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, {
    metered: false,
    pendingUsage: false,
    pendingMeter: false,
    unpaid: false,
    canceled: false,
    frozen: false,
    race: false,
    teamOwner: false,
    teamContact: false,
    oldSchema: false,
    deleted: [],
    detached: [],
  });
  takeDetachedTeamBillingContacts("user");
});
test("a metered cancellation waits for the natural final usage invoice", async () => {
  state.metered = true;
  expect((await getAccountDeletionStatus("user")).state).toBe("billingPending");
  await expect(deletePersonalStripeCustomers("user")).rejects.toThrow("Wait for usage billing");
  expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  expect(stripe.customers.del).not.toHaveBeenCalled();
});
test.each(["pendingUsage", "pendingMeter", "unpaid"] as const)(
  "%s prevents deletion even after subscription cancellation",
  async (key) => {
    state[key] = true;
    state.canceled = true;
    await expect(deletePersonalStripeCustomers("user")).rejects.toThrow("Wait for usage billing");
    expect(stripe.customers.del).not.toHaveBeenCalled();
  },
);
test("a prepaid cancellation still allows immediate deletion without a refund", async () => {
  await deletePersonalStripeCustomers("user");
  expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("subscription", {
    prorate: false,
    invoice_now: false,
  });
  expect(stripe.customers.del).toHaveBeenCalledWith("customer");
});
test("a reservation created while checking Stripe is caught before freezing or deletion", async () => {
  state.race = true;
  await expect(deletePersonalStripeCustomers("user")).rejects.toThrow("Usage settlement");
  expect(state.frozen).toBe(false);
  expect(stripe.customers.del).not.toHaveBeenCalled();
});
test("the deletion status preview leaves Stripe Search to the deletion itself", async () => {
  state.canceled = true;
  expect((await getAccountDeletionStatus("user")).state).toBe("ready");
  expect(stripe.customers.search).not.toHaveBeenCalled();

  await deletePersonalStripeCustomers("user");
  expect(stripe.customers.search).toHaveBeenCalledTimes(1);
});

test("a former team owner can delete their account while the team keeps paying", async () => {
  state.teamContact = true;
  state.canceled = true;
  expect((await getAccountDeletionStatus("user")).state).toBe("ready");

  await deletePersonalStripeCustomers("user");
  // Only the personal customer goes; the team's subscription and customer stay.
  expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  expect(stripe.customers.del).toHaveBeenCalledTimes(1);
  expect(stripe.customers.del).toHaveBeenCalledWith("customer");
  // The team's row survives without a contact instead of being deleted with the user.
  expect(state.detached).toHaveLength(1);
  expect(state.detached[0]?.values).toMatchObject({ userId: null });
  const query = new PgDialect().sqlToQuery(state.detached[0]?.condition as SQL);
  expect(query.sql).toBe('("billing"."user_id" = $1 and "billing"."organization_id" is not null)');
  expect(query.params).toEqual(["user"]);
  // Handed to the user delete hooks once, to move the team's invoices.
  expect(takeDetachedTeamBillingContacts("user")).toEqual(["team"]);
  expect(takeDetachedTeamBillingContacts("user")).toEqual([]);
});

test("before the SET NULL migration a billing contact's deletion stops before Stripe", async () => {
  // Without the migration the user delete would cascade to the team's billing row.
  state.teamContact = true;
  state.oldSchema = true;
  state.canceled = true;

  await expect(deletePersonalStripeCustomers("user")).rejects.toThrow("user_id");
  expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  expect(stripe.customers.del).not.toHaveBeenCalled();
  expect(takeDetachedTeamBillingContacts("user")).toEqual([]);
});

test("a retried deletion still hands over the teams an earlier attempt detached", async () => {
  state.teamContact = true;
  vi.mocked(stripe.customers.del).mockRejectedValueOnce(new Error("Stripe is down"));
  await expect(deletePersonalStripeCustomers("user")).rejects.toThrow("Stripe is down");

  // The first attempt already cleared the contact, so the retry finds no row.
  state.teamContact = false;
  state.canceled = false;
  state.frozen = false;
  await deletePersonalStripeCustomers("user");
  expect(takeDetachedTeamBillingContacts("user")).toEqual(["team"]);
});

test("a current team owner is still blocked from deleting their account", async () => {
  state.teamOwner = true;
  expect((await getAccountDeletionStatus("user")).state).toBe("teamOwner");
  await expect(deletePersonalStripeCustomers("user")).rejects.toThrow("transfer its ownership");
  expect(stripe.customers.del).not.toHaveBeenCalled();
});

test("team billing rows outlive their contact, and no user deletion fails on billing", () => {
  const config = getTableConfig(billing);
  const [userReference] = config.foreignKeys;
  expect(billing.userId.notNull).toBe(false);
  expect(userReference?.reference().columns.map((column) => column.name)).toEqual(["user_id"]);
  // The deleted user's team row survives with user_id NULL instead of cascading.
  expect(userReference?.onDelete).toBe("set null");
  // Code from before this schema deletes users without removing their personal
  // row first. The migration lands before the code, so that deletion must only
  // orphan the row: a CHECK requiring personal rows to keep their user would
  // fail it after better-auth removed the sessions and accounts.
  expect(config.checks).toEqual([]);
});

test("account deletion removes the personal billing row explicitly, never a team row", async () => {
  await deletePersonalBillingRecords("user");
  expect(state.deleted).toHaveLength(1);
  expect(state.deleted[0]?.table).toBe("billing");
  const query = new PgDialect().sqlToQuery(state.deleted[0]?.condition as SQL);
  expect(query.sql).toBe('("billing"."user_id" = $1 and "billing"."organization_id" is null)');
  expect(query.params).toEqual(["user"]);
});
