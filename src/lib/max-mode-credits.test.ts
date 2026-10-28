import { expect, test, vi } from "vitest";

vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_BETTER_AUTH_URL: "https://deni.test" } }));
vi.mock("./stripe", () => ({ stripe: {} }));
vi.mock("./billing-config", () => ({ isBillingDisabled: false }));

const {
  creditOwnerFor,
  creditOwnerFromMetadata,
  isValidCreditAmount,
  MAX_MODE_CREDIT_PURPOSE,
  MAX_MODE_CREDIT_UNITS,
  spendMaxModeCredits,
} = await import("./max-mode-credits");
const { isMaxModeEligible } = await import("./max-mode");

/** A transaction stand-in: the lots query returns `lots`; updates are recorded. */
function fakeDatabase(lots: { id: string; remaining: number }[]) {
  const updates: { id: string; take: number }[] = [];
  let pendingTake = 0;
  const database = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ for: async () => lots }),
        }),
      }),
    }),
    update: () => ({
      set: (values: { remainingUnits: { queryChunks: unknown[] } }) => {
        // `remaining_units - take`: the parameter is the last chunk value.
        const chunks = values.remainingUnits.queryChunks;
        pendingTake = Number(chunks.find((chunk) => typeof chunk === "number"));
        return {
          where: async (condition: { queryChunks: unknown[] }) => {
            const id = condition.queryChunks
              .map((chunk) => (chunk as { value?: unknown }).value)
              .find((value) => typeof value === "string" && lots.some((lot) => lot.id === value));
            updates.push({ id: String(id), take: pendingTake });
          },
        };
      },
    }),
  };
  return { database: database as never, updates };
}

const owner = { userId: "user", organizationId: null } as const;

test("one credit is $1 of the pool", () => {
  expect(MAX_MODE_CREDIT_UNITS).toBe(2_000_000);
});

test("credit amounts are whole credits from 5 to 500", () => {
  expect(isValidCreditAmount(5)).toBe(true);
  expect(isValidCreditAmount(500)).toBe(true);
  expect(isValidCreditAmount(4)).toBe(false);
  expect(isValidCreditAmount(501)).toBe(false);
  expect(isValidCreditAmount(7.5)).toBe(false);
});

test("team credits belong to the organization, personal credits to the user", () => {
  expect(creditOwnerFor({ userId: "u", organizationId: "org" })).toEqual({
    userId: null,
    organizationId: "org",
  });
  expect(creditOwnerFor({ userId: "u", organizationId: null })).toEqual({
    userId: "u",
    organizationId: null,
  });
  expect(creditOwnerFor({ userId: null, organizationId: null })).toBeNull();
});

test("only credit metadata names a credit owner", () => {
  expect(creditOwnerFromMetadata({ purpose: MAX_MODE_CREDIT_PURPOSE, creditUserId: "u" })).toEqual({
    userId: "u",
    organizationId: null,
  });
  expect(
    creditOwnerFromMetadata({ purpose: MAX_MODE_CREDIT_PURPOSE, organizationId: "org" }),
  ).toEqual({ userId: null, organizationId: "org" });
  expect(creditOwnerFromMetadata({ creditUserId: "u" })).toBeNull();
  expect(creditOwnerFromMetadata({ purpose: MAX_MODE_CREDIT_PURPOSE })).toBeNull();
});

test("every paid plan can use Max Mode credits", () => {
  for (const planId of ["go_monthly", "plus_yearly", "pro_monthly", "pro_team_yearly"])
    expect(isMaxModeEligible(planId)).toBe(true);
  expect(isMaxModeEligible(null)).toBe(false);
  expect(isMaxModeEligible("max_monthly")).toBe(false);
});

test("spending takes the lots that expire first and stops at the balance", async () => {
  const { database, updates } = fakeDatabase([
    { id: "soon", remaining: 300 },
    { id: "later", remaining: 1_000 },
  ]);
  expect(await spendMaxModeCredits(owner, 500, new Date(), database)).toBe(500);
  expect(updates).toEqual([
    { id: "soon", take: 300 },
    { id: "later", take: 200 },
  ]);
});

test("usage past the credits left is not spent", async () => {
  const { database } = fakeDatabase([{ id: "only", remaining: 100 }]);
  expect(await spendMaxModeCredits(owner, 500, new Date(), database)).toBe(100);
});

test("nothing is spent for no overage", async () => {
  const { database, updates } = fakeDatabase([{ id: "only", remaining: 100 }]);
  expect(await spendMaxModeCredits(owner, 0, new Date(), database)).toBe(0);
  expect(updates).toEqual([]);
});
