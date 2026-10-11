import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  personal: [] as Record<string, unknown>[],
  team: [] as Record<string, unknown>[],
}));

// loadTierInfo reads the personal billing row (where/limit), the active team
// billing rows (innerJoin/where) and the team policies (where/limit).
vi.mock("@/db/drizzle", async () => {
  const { getTableName } = await import("drizzle-orm");
  return {
    db: {
      select: () => ({
        from: (table: Parameters<typeof getTableName>[0]) => ({
          where: () => ({
            limit: async () => (getTableName(table) === "billing" ? state.personal : []),
          }),
          innerJoin: () => ({ where: async () => state.team }),
        }),
      }),
    },
  };
});
vi.mock("./max-mode", () => ({
  isMaxModeEligible: () => false,
  deliverMaxModeUsageReport: vi.fn(async () => {}),
}));
vi.mock("./billing-config", () => ({ isBillingDisabled: false }));
vi.mock("./stripe", () => ({ stripe: {} }));

const { getSubscriptionTier } = await import("./usage");

const now = new Date("2026-10-01T00:00:00Z");
const later = new Date("2026-11-01T00:00:00Z");

function billingRow(planId: string, status: string, organizationId: string | null = null) {
  return {
    id: `billing-${planId}`,
    deletionPending: false,
    stripeCustomerId: "cus_1",
    organizationId,
    planId,
    status,
    currentPeriodEnd: later,
    maxModeEnabled: false,
    paymentMethodFingerprint: null,
    cardRemovedAt: null,
  };
}

beforeEach(() => {
  state.personal = [];
  state.team = [];
});

test("team members get their team plan's tier", async () => {
  state.team = [billingRow("max_team_monthly", "active", "org")];
  expect(await getSubscriptionTier("user", now)).toBe("max");
  state.team = [billingRow("pro_team_yearly", "active", "org")];
  expect(await getSubscriptionTier("user", now)).toBe("pro");
});

test("personal plans map to their tier, lifetime Pro included", async () => {
  state.personal = [billingRow("pro_lifetime", "paid")];
  expect(await getSubscriptionTier("user", now)).toBe("pro");
  state.personal = [billingRow("plus_monthly", "active")];
  expect(await getSubscriptionTier("user", now)).toBe("plus");
  state.personal = [billingRow("max_yearly", "active")];
  expect(await getSubscriptionTier("user", now)).toBe("max");
});

test("users without an active plan are free", async () => {
  expect(await getSubscriptionTier("user", now)).toBe("free");
  state.personal = [billingRow("pro_monthly", "inactive")];
  expect(await getSubscriptionTier("user", now)).toBe("free");
});
