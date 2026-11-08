import { getTableName } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import { getUsageSummary } from "./usage";

const state = vi.hoisted(() => ({
  flagged: false,
  fingerprint: null as string | null,
  cardRemovedAt: null as Date | null,
}));
vi.mock("./max-mode", () => ({
  isMaxModeEligible: () => false,
  MAX_MODE_USABLE_STATUSES: new Set(["active"]),
}));
vi.mock("./max-mode-credits", () => ({
  creditOwnerFor: () => null,
  getMaxModeCreditUnits: async () => 0,
  spendMaxModeCredits: async () => 0,
  maybeAutoTopUpMaxModeCredits: async () => false,
}));
vi.mock("@/db/drizzle", () => ({
  db: {
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const query = {
          innerJoin: () => query,
          where: () => {
            const name = getTableName(table);
            let rows: Record<string, unknown>[] = [];
            // A Free account: a billing row with no plan, and no team.
            if (name === "billing" && !("joined" in query))
              rows = [
                {
                  planId: null,
                  status: "inactive",
                  paymentMethodFingerprint: state.fingerprint,
                  cardRemovedAt: state.cardRemovedAt,
                },
              ];
            if (name === "signup_risk" && state.flagged) rows = [{ userId: "user" }];
            const result = Promise.resolve(rows);
            return Object.assign(result, { limit: () => result });
          },
        };
        return query;
      },
    }),
  },
}));

beforeEach(() => {
  state.flagged = false;
  state.fingerprint = null;
  state.cardRemovedAt = null;
});

const summary = () => getUsageSummary({ userId: "user", now: new Date("2026-06-10") });
// One pool for all usage ($ x 2M units, see usage-pool.ts).
const limits = async () => (await summary()).pool?.limit;

test("an unflagged Free account gets the normal Free pool", async () => {
  expect(await limits()).toBe(20_000_000);
  expect((await summary()).usage.map(({ limit }) => limit)).toEqual([20_000_000]);
});

test("a Free account flagged at sign-up gets the reduced pool", async () => {
  state.flagged = true;
  expect(await limits()).toBe(4_000_000);
});

test("verifying a payment method lifts the reduction", async () => {
  state.flagged = true;
  state.fingerprint = "fp_card";
  expect(await limits()).toBe(30_000_000);
});

test("a removed card keeps its fingerprint but no longer lifts the Free pool", async () => {
  state.flagged = true;
  state.fingerprint = "fp_card";
  state.cardRemovedAt = new Date("2026-06-01");
  expect(await limits()).toBe(4_000_000);
  expect((await summary()).hasVerifiedPaymentMethod).toBe(false);
});

test("the summary tells a limited user the way out, and nobody else", async () => {
  expect((await summary()).signupLimited).toBe(false);

  state.flagged = true;
  expect((await summary()).signupLimited).toBe(true);

  state.fingerprint = "fp_card";
  expect((await summary()).signupLimited).toBe(false);
});
