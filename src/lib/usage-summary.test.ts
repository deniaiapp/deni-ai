import { getTableName } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { getUsageSummary } from "./usage";

const state = vi.hoisted(() => ({
  billingReads: 0,
  team: false,
  ledger: [] as Record<string, unknown>[],
}));
vi.mock("./max-mode", () => ({
  isMaxModeEligible: () => true,
  MAX_MODE_USABLE_STATUSES: new Set(["active", "paid"]),
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
        let joined = false;
        const query = {
          innerJoin: () => {
            joined = true;
            return query;
          },
          where: () => {
            const name = getTableName(table);
            let rows: Record<string, unknown>[] = [];
            if (name === "billing") {
              state.billingReads++;
              rows = joined
                ? state.team
                  ? [
                      {
                        id: "team-row",
                        organizationId: "team",
                        planId: "pro_team_monthly",
                        status: "active",
                        currentPeriodEnd: new Date("2026-07-01"),
                        maxModeEnabled: true,
                      },
                    ]
                  : []
                : [
                    {
                      planId: state.team ? "plus_monthly" : "pro_monthly",
                      status: "active",
                      currentPeriodEnd: new Date("2026-07-01"),
                      maxModeEnabled: true,
                    },
                  ];
            }
            if (name === "usage_quota")
              rows = ["basic", "premium"].map((category) => ({
                category,
                used: 123,
                unit: "units",
                periodStart: new Date("2026-06-01"),
                periodEnd: new Date("2026-07-01"),
              }));
            if (name === "product_usage") rows = state.ledger;
            const result = Promise.resolve(rows);
            return Object.assign(result, { limit: () => result });
          },
        };
        return query;
      },
    }),
  },
}));

test.each([false, true])(
  "summary resolves personal/team entitlement once (team=%s)",
  async (team) => {
    state.team = team;
    state.billingReads = 0;
    const summary = await getUsageSummary({ userId: "user", now: new Date("2026-06-10") });
    // One entitlement lookup reads personal billing and joined team billing once each.
    expect(state.billingReads).toBe(2);
    // A Pro team outranks the member's personal Plus.
    expect(summary.tier).toBe("pro");
    // One pool (Pro $200 = 400M units), not split by model class.
    // Rows written before the change (premium) still count; with no ledger, all is chat.
    const pool = 400_000_000;
    expect(summary.pool).toMatchObject({ limit: pool, used: { chat: 246, flixa: 0, run: 0 } });
    expect(
      summary.usage.map(({ category, limit, used, remaining }) => ({
        category,
        limit,
        used,
        remaining,
      })),
    ).toEqual([{ category: "basic", limit: pool, used: 246, remaining: pool - 246 }]);
  },
);

test("the pool is split by product from this month's ledger", async () => {
  state.team = false;
  state.ledger = [
    { product: "chat", unit: "units", used: 100 },
    { product: "flixa", unit: "units", used: 300 },
    // $1.50 of Deni Run = 3M units.
    { product: "run", unit: "usd_micros", used: 1_500_000 },
  ];
  const summary = await getUsageSummary({ userId: "user", now: new Date("2026-06-10") });
  // 246 quota units split 1:3 between chat and Flixa.
  expect(summary.pool?.used).toEqual({ chat: 61, flixa: 185, run: 3_000_000 });
  expect(summary.usage[0]).toMatchObject({ used: 3_000_246, remaining: 400_000_000 - 3_000_246 });
  state.ledger = [];
});
