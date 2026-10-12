import { beforeEach, expect, test, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/lib/billing-config", () => ({ isBillingDisabled: false }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/stripe", () => ({
  stripe: { paymentIntents: { list: mocks.list, create: mocks.create } },
}));

const { billingRouter } = await import("./billing");

// An existing personal billing row, so no customer is created.
const record = { stripeCustomerId: "cus_1", flashOfferEndsAt: new Date(0), deletionPending: false };
const billing = billingRouter.createCaller({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [record] }) }) }) },
  session: { session: { userId: "user-1" }, user: { id: "user-1", isAnonymous: false } },
} as never);

const openIntent = {
  id: "pi_open",
  client_secret: "pi_open_secret",
  status: "requires_payment_method",
  amount: 100,
  currency: "usd",
  capture_method: "manual",
  metadata: { userId: "user-1", purpose: "free_tier_verification" },
  payment_method_options: { card: { request_three_d_secure: "any" } },
} as unknown as Stripe.PaymentIntent;

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue({ data: [] });
  mocks.create.mockReset().mockResolvedValue({ id: "pi_new", client_secret: "pi_new_secret" });
});

test("reopening card verification reuses the intent still waiting for a card", async () => {
  mocks.list.mockResolvedValue({ data: [openIntent] });
  await expect(billing.createCardSetupIntent()).resolves.toEqual({
    clientSecret: "pi_open_secret",
    paymentIntentId: "pi_open",
  });
  expect(mocks.list).toHaveBeenCalledWith({ customer: "cus_1", limit: 10 });
  expect(mocks.create).not.toHaveBeenCalled();
});

test.each([
  ["already authorized", { status: "requires_capture" }],
  ["canceled after a refused card", { status: "canceled" }],
  ["for a different purpose", { metadata: { userId: "user-1" } }],
  ["for another user", { metadata: { userId: "user-2", purpose: "free_tier_verification" } }],
  ["without 3D Secure", { payment_method_options: { card: {} } }],
  ["for another amount", { amount: 5000 }],
])("an intent %s is not reused", async (_case, changes) => {
  mocks.list.mockResolvedValue({ data: [{ ...openIntent, ...changes }] });
  await expect(billing.createCardSetupIntent()).resolves.toEqual({
    clientSecret: "pi_new_secret",
    paymentIntentId: "pi_new",
  });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      customer: "cus_1",
      amount: 100,
      capture_method: "manual",
      metadata: { userId: "user-1", purpose: "free_tier_verification" },
    }),
  );
});
