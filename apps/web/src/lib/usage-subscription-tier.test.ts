import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  personal: [] as Record<string, unknown>[],
  team: [] as Record<string, unknown>[],
  user: [] as Record<string, unknown>[],
}));

// loadTierInfo reads the personal billing row (where/limit), the active team
// billing rows (innerJoin/where), the team policies (where/limit), and, for
// accounts without a plan, the user row (where/limit).
vi.mock("@/db/drizzle", async () => {
  const { getTableName } = await import("drizzle-orm");
  return {
    db: {
      select: () => ({
        from: (table: Parameters<typeof getTableName>[0]) => ({
          where: () => ({
            limit: async () => {
              const name = getTableName(table);
              return name === "billing" ? state.personal : name === "user" ? state.user : [];
            },
          }),
          innerJoin: () => ({ where: async () => state.team }),
        }),
      }),
    },
  };
});
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
vi.mock("./billing-config", () => ({ isBillingDisabled: false }));
vi.mock("./stripe", () => ({ stripe: {} }));

const { getSubscriptionTier, hasEducationGo } = await import("./usage");

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
  state.user = [];
});

function userRow(email: string, emailVerified = true, isAnonymous = false) {
  return { email, emailVerified, isAnonymous };
}

test("team members get their team plan's tier", async () => {
  state.team = [billingRow("pro_team_monthly", "active", "org")];
  expect(await getSubscriptionTier("user", now)).toBe("pro");
  state.team = [billingRow("pro_team_yearly", "active", "org")];
  expect(await getSubscriptionTier("user", now)).toBe("pro");
});

test("personal plans map to their tier", async () => {
  state.personal = [billingRow("pro_yearly", "active")];
  expect(await getSubscriptionTier("user", now)).toBe("pro");
  state.personal = [billingRow("plus_monthly", "active")];
  expect(await getSubscriptionTier("user", now)).toBe("plus");
  state.personal = [billingRow("go_monthly", "active")];
  expect(await getSubscriptionTier("user", now)).toBe("go");
});

test("users without an active plan are free", async () => {
  expect(await getSubscriptionTier("user", now)).toBe("free");
  state.personal = [billingRow("pro_monthly", "inactive")];
  expect(await getSubscriptionTier("user", now)).toBe("free");
});

test("a verified educational address gets Go for free", async () => {
  state.user = [userRow("student@u-tokyo.ac.jp")];
  expect(await getSubscriptionTier("user", now)).toBe("go");
  expect(await hasEducationGo("user", now)).toBe(true);
  state.personal = [billingRow("plus_monthly", "inactive")];
  expect(await getSubscriptionTier("user", now)).toBe("go");
});

test("education does not apply to unverified, guest, or non-educational addresses", async () => {
  state.user = [userRow("student@mit.edu", false)];
  expect(await getSubscriptionTier("user", now)).toBe("free");
  state.user = [userRow("student@mit.edu", true, true)];
  expect(await getSubscriptionTier("user", now)).toBe("free");
  state.user = [userRow("someone@outlook.com")];
  expect(await getSubscriptionTier("user", now)).toBe("free");
  state.user = [userRow("someone@foo.edu.co")];
  expect(await getSubscriptionTier("user", now)).toBe("free");
});

test("paid and team plans take precedence over education", async () => {
  state.user = [userRow("student@mit.edu")];
  state.personal = [billingRow("pro_monthly", "active")];
  expect(await getSubscriptionTier("user", now)).toBe("pro");
  expect(await hasEducationGo("user", now)).toBe(false);
  state.personal = [];
  state.team = [billingRow("pro_team_monthly", "active", "org")];
  expect(await getSubscriptionTier("user", now)).toBe("pro");
});
