import { beforeEach, expect, test, vi } from "vitest";
import { stripe } from "@/lib/stripe";
import { redirectTeamBillingEmail, releaseTeamBillingContact } from "./team-billing-contact";

type Row = { id: string; userId: string | null; organizationId: string; stripeCustomerId: string };

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  emails: new Map<string, string>(),
  owner: "owner@example.com" as string | null,
  ownerQueries: [] as unknown[][],
  customer: {} as Record<string, unknown>,
  releaseFails: false,
}));

vi.mock("@/db/drizzle", async () => {
  const { getTableName } = await import("drizzle-orm");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const params = (condition: never) => dialect.sqlToQuery(condition).params;
  return {
    db: {
      update: () => ({
        set: (values: Partial<Row>) => ({
          where: async (condition: never) => {
            // A database still on the NOT NULL column rejects the release.
            if (state.releaseFails) throw new Error("null value in column user_id");
            const [organizationId, userId] = params(condition);
            state.rows
              .filter((row) => row.organizationId === organizationId && row.userId === userId)
              .forEach((row) => Object.assign(row, values));
          },
        }),
      }),
      select: () => ({
        from: (table: Parameters<typeof getTableName>[0]) => ({
          // The former member's own address.
          where: (condition: never) => ({
            limit: async () => {
              expect(getTableName(table)).toBe("user");
              const email = state.emails.get(params(condition)[0] as string);
              return email ? [{ email }] : [];
            },
          }),
          // The current owner who takes over the invoices.
          innerJoin: () => ({
            where: (condition: never) => ({
              orderBy: () => ({
                limit: async () => {
                  state.ownerQueries.push(params(condition));
                  return state.owner ? [{ email: state.owner }] : [];
                },
              }),
            }),
          }),
        }),
      }),
    },
  };
});
vi.mock("@/lib/billing-config", () => ({ isBillingDisabled: false }));
vi.mock("@/lib/team-billing-record", () => ({
  findTeamBillingRecord: async (_database: unknown, organizationId: string) =>
    state.rows.find((row) => row.organizationId === organizationId),
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    customers: {
      retrieve: vi.fn(async () => state.customer),
      update: vi.fn(async () => ({})),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [
    { id: "team-row", userId: "former", organizationId: "team", stripeCustomerId: "cus_team" },
    { id: "other-row", userId: "former", organizationId: "other", stripeCustomerId: "cus_other" },
  ];
  state.emails = new Map([["former", "Former@Example.com"]]);
  state.owner = "owner@example.com";
  state.ownerQueries = [];
  state.releaseFails = false;
  state.customer = {
    id: "cus_team",
    email: "former@example.com",
    metadata: { organizationId: "team", userId: "former" },
  };
});

test("a departing billing contact is cleared and invoices move to a current owner", async () => {
  await releaseTeamBillingContact("team", "former");

  // The team row stays with its organization; only the contact is cleared.
  expect(state.rows).toEqual([
    {
      id: "team-row",
      userId: null,
      organizationId: "team",
      stripeCustomerId: "cus_team",
      updatedAt: expect.any(Date),
    },
    { id: "other-row", userId: "former", organizationId: "other", stripeCustomerId: "cus_other" },
  ]);
  expect(state.ownerQueries).toEqual([["team", "owner", false]]);
  expect(stripe.customers.retrieve).toHaveBeenCalledWith("cus_team");
  expect(stripe.customers.update).toHaveBeenCalledWith("cus_team", {
    email: "owner@example.com",
  });
});

test("an address the team set for its invoices is kept", async () => {
  // Another admin created the customer, so this address is the team's own.
  state.customer = {
    ...state.customer,
    email: "accounts@example.com",
    metadata: { organizationId: "team", userId: "admin" },
  };
  await releaseTeamBillingContact("team", "former");

  expect(state.rows[0]?.userId).toBeNull();
  expect(stripe.customers.update).not.toHaveBeenCalled();
});

test("a customer created for the departing member moves from their older address", async () => {
  // They changed their email after the team customer was created.
  state.customer = { ...state.customer, email: "old-address@example.com" };
  await releaseTeamBillingContact("team", "former");

  expect(stripe.customers.update).toHaveBeenCalledWith("cus_team", {
    email: "owner@example.com",
  });
});

test("invoices move even when the departing member is not the row's billing contact", async () => {
  // The row was recreated by another admin and reused the departing member's customer.
  state.rows[0]!.userId = "admin";
  await releaseTeamBillingContact("team", "former");

  expect(state.rows[0]?.userId).toBe("admin");
  expect(stripe.customers.update).toHaveBeenCalledWith("cus_team", {
    email: "owner@example.com",
  });
});

test("a member unrelated to the team's billing changes nothing", async () => {
  state.rows[0]!.userId = "admin";
  state.customer = {
    ...state.customer,
    email: "admin@example.com",
    metadata: { organizationId: "team", userId: "admin" },
  };
  await releaseTeamBillingContact("team", "former");

  expect(state.rows[0]?.userId).toBe("admin");
  expect(stripe.customers.update).not.toHaveBeenCalled();
});

test("a customer already sent to the owner is not rewritten", async () => {
  state.customer = { ...state.customer, email: "Owner@Example.com" };
  await releaseTeamBillingContact("team", "former");

  expect(stripe.customers.update).not.toHaveBeenCalled();
});

test("invoices still move when the database refuses to clear the contact", async () => {
  state.releaseFails = true;
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(releaseTeamBillingContact("team", "former")).resolves.toBeUndefined();
  expect(state.rows[0]?.userId).toBe("former");
  expect(stripe.customers.update).toHaveBeenCalledWith("cus_team", {
    email: "owner@example.com",
  });
  consoleError.mockRestore();
});

test("a customer the organization does not own is never edited", async () => {
  // A legacy team row can reference the former member's personal customer.
  state.customer = { ...state.customer, metadata: { userId: "former" } };
  await releaseTeamBillingContact("team", "former");

  expect(stripe.customers.update).not.toHaveBeenCalled();
});

test("a Stripe failure never fails the membership change", async () => {
  vi.mocked(stripe.customers.retrieve).mockRejectedValueOnce(new Error("Stripe is down"));
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(releaseTeamBillingContact("team", "former")).resolves.toBeUndefined();
  expect(state.rows[0]?.userId).toBeNull();
  expect(consoleError).toHaveBeenCalled();
  consoleError.mockRestore();
});

test("a deleted account's team invoices move to an owner when one remains", async () => {
  const former = { userId: "former", email: "former@example.com" };
  await redirectTeamBillingEmail("team", former);
  expect(stripe.customers.update).toHaveBeenCalledWith("cus_team", {
    email: "owner@example.com",
  });

  vi.clearAllMocks();
  state.owner = null;
  const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await redirectTeamBillingEmail("team", former);
  expect(stripe.customers.update).not.toHaveBeenCalled();
  consoleWarn.mockRestore();
});
