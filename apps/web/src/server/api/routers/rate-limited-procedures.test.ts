import { beforeEach, expect, test, vi } from "vitest";
import type { Context } from "../trpc";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(
    async (_options: { key: string; windowMs: number; maxRequests: number }) => ({
      allowed: false as const,
      retryAfter: 60,
    }),
  ),
}));

/** A refused call must not reach Stripe or the database. */
const untouchable = (name: string) =>
  new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`${name}.${String(property)} used by a rate-limited call`);
      },
    },
  );

vi.mock("@/db/drizzle", () => ({ db: untouchable("db") }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/lib/billing-config", () => ({ isBillingDisabled: false }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/stripe", () => ({ stripe: untouchable("stripe") }));

const { billingRouter } = await import("./billing");
const { organizationRouter } = await import("./organization");
const { chatRouter } = await import("./chat");

const ctx = {
  db: untouchable("ctx.db") as Context["db"],
  session: { session: { userId: "user-1" }, user: { id: "user-1" } } as Context["session"],
};
const billing = billingRouter.createCaller(ctx);
const organization = organizationRouter.createCaller(ctx);
const chat = chatRouter.createCaller(ctx);

beforeEach(() => mocks.checkRateLimit.mockClear());

test.each([
  ["billing.accountDeletionStatus", 10, () => billing.accountDeletionStatus()],
  ["billing.plans", 30, () => billing.plans()],
  ["billing.flashOffer", 30, () => billing.flashOffer()],
  ["billing.status", 30, () => billing.status()],
  ["billing.getCheckoutSession", 30, () => billing.getCheckoutSession({ sessionId: "cs_1" })],
  ["billing.estimatePlanChange", 30, () => billing.estimatePlanChange({ planId: "pro_monthly" })],
  ["billing.maxModeStatus", 60, () => billing.maxModeStatus()],
  ["organization.teamPlans", 30, () => organization.teamPlans()],
  [
    "organization.invitationBillingImpact",
    30,
    () => organization.invitationBillingImpact({ invitationId: "invitation" }),
  ],
  [
    "organization.teamBillingStatus",
    30,
    () => organization.teamBillingStatus({ organizationId: "org" }),
  ],
  [
    "organization.teamMaxModeSettings",
    60,
    () => organization.teamMaxModeSettings({ organizationId: "org" }),
  ],
  [
    "organization.getTeamCheckoutSession",
    30,
    () => organization.getTeamCheckoutSession({ organizationId: "org", sessionId: "cs_1" }),
  ],
  [
    "organization.estimateTeamPlanChange",
    30,
    () =>
      organization.estimateTeamPlanChange({ organizationId: "org", planId: "pro_team_monthly" }),
  ],
  // Refetched after every sent message and every sidebar delete, pin, edit or move.
  ["chat.getChats", 120, () => chat.getChats()],
  // Stripe-backed mutations: one click each.
  [
    "billing.createCheckoutSession",
    10,
    () => billing.createCheckoutSession({ planId: "pro_monthly" }),
  ],
  ["billing.createPortalSession", 10, () => billing.createPortalSession()],
  ["billing.changePlan", 10, () => billing.changePlan({ planId: "pro_monthly" })],
  ["billing.cancelSubscription", 10, () => billing.cancelSubscription()],
  ["billing.resumeSubscription", 10, () => billing.resumeSubscription()],
  ["billing.enableMaxMode", 10, () => billing.enableMaxMode()],
  ["billing.removeVerifiedCard", 10, () => billing.removeVerifiedCard()],
  [
    "organization.createTeamCheckoutSession",
    10,
    () =>
      organization.createTeamCheckoutSession({ organizationId: "org", planId: "pro_team_monthly" }),
  ],
  [
    "organization.createTeamPortalSession",
    10,
    () => organization.createTeamPortalSession({ organizationId: "org" }),
  ],
  [
    "organization.changeTeamPlan",
    10,
    () => organization.changeTeamPlan({ organizationId: "org", planId: "pro_team_yearly" }),
  ],
  [
    "organization.cancelTeamSubscription",
    10,
    () => organization.cancelTeamSubscription({ organizationId: "org" }),
  ],
  [
    "organization.resumeTeamSubscription",
    10,
    () => organization.resumeTeamSubscription({ organizationId: "org" }),
  ],
  [
    "organization.updateTeamMaxModeEnabled",
    10,
    () => organization.updateTeamMaxModeEnabled({ organizationId: "org", enabled: true }),
  ],
  ["organization.syncSeatCount", 10, () => organization.syncSeatCount({ organizationId: "org" })],
])("%s is limited to %i calls a minute per user", async (name, maxRequests, call) => {
  await expect(call()).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
    message: "Too many requests. Please try again later.",
  });
  expect(mocks.checkRateLimit).toHaveBeenCalledExactlyOnceWith({
    key: `trpc:${name}:user-1`,
    windowMs: 60_000,
    maxRequests,
  });
});

// Each verification intent is a $1 authorization its client secret can attempt
// with any card, so creating and confirming them is budgeted per hour.
test.each([
  ["billing.createCardSetupIntent", () => billing.createCardSetupIntent()],
  ["billing.confirmCardSetup", () => billing.confirmCardSetup({ paymentIntentId: "pi_1" })],
])("%s is limited to 10 calls an hour per user", async (name, call) => {
  await expect(call()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect(mocks.checkRateLimit).toHaveBeenCalledExactlyOnceWith({
    key: `trpc:${name}:user-1`,
    windowMs: 60 * 60_000,
    maxRequests: 10,
  });
});
