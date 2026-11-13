import { beforeEach, expect, test, vi } from "vitest";
import type { BetaAccessStore } from "@/lib/beta-access-store";

vi.mock("@/env", () => ({
  env: { ADMIN_EMAILS: "ops@example.com", BETA_ACCESS_REQUIRED: true },
}));

const plan = vi.hoisted(() => ({ tier: "free", education: false }));
vi.mock("@/lib/usage", () => ({
  getSubscriptionTier: async () => plan.tier,
  hasEducationGo: async () => plan.education,
}));

const { isBetaGatedServerPath, isGuestSignInPath } = await import("@/lib/beta-access");
const { createBetaAccessGate, forgetBetaAccess, hasBetaAccess, isOnPaidPlan } =
  await import("@/lib/beta-access.server");

type Grant = { id: string; email: string; userId: string | null };
let grants: Grant[];

const store: BetaAccessStore = {
  hasUserGrant: vi.fn(async (userId: string) => grants.some((grant) => grant.userId === userId)),
  claimEmailGrant: vi.fn(async (email: string, userId: string) => {
    const grant = grants.find(
      (row) => row.email === email && (row.userId === null || row.userId === userId),
    );
    if (grant) grant.userId = userId;
    return Boolean(grant);
  }),
  list: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
};

beforeEach(() => {
  grants = [];
  vi.mocked(store.hasUserGrant).mockClear();
  vi.mocked(store.claimEmailGrant).mockClear();
  for (const id of ["u1", "u2", "ops", "guest"]) forgetBetaAccess(id);
  plan.tier = "free";
  plan.education = false;
});

const tester = { id: "u1", email: "Tester@Example.com", emailVerified: true, isAnonymous: false };

test("without the gate everyone has access and nothing is read", async () => {
  expect(await hasBetaAccess({ id: "guest", isAnonymous: true }, { required: false, store })).toBe(
    true,
  );
  expect(store.hasUserGrant).not.toHaveBeenCalled();
});

test("guests never have access, even with a matching grant", async () => {
  grants.push({ id: "g", email: "guest@example.com", userId: "guest" });
  const guest = { id: "guest", email: "guest@example.com", emailVerified: true, isAnonymous: true };
  expect(await hasBetaAccess(guest, { required: true, store })).toBe(false);
});

test("verified admins always have access", async () => {
  const admin = { id: "ops", email: "ops@example.com", emailVerified: true, isAnonymous: false };
  expect(await hasBetaAccess(admin, { required: true, store })).toBe(true);
  expect(store.hasUserGrant).not.toHaveBeenCalled();
  // An unverified admin address proves nothing.
  expect(await hasBetaAccess({ ...admin, emailVerified: false }, { required: true, store })).toBe(
    false,
  );
});

test("a grant by email is linked to the verified user on first match", async () => {
  grants.push({ id: "g1", email: "tester@example.com", userId: null });
  expect(await hasBetaAccess(tester, { required: true, store })).toBe(true);
  expect(store.claimEmailGrant).toHaveBeenCalledWith("tester@example.com", "u1");
  expect(grants[0]?.userId).toBe("u1");
});

test("a linked grant follows the account after an email change", async () => {
  grants.push({ id: "g1", email: "old@example.com", userId: "u1" });
  expect(
    await hasBetaAccess({ ...tester, email: "new@example.com" }, { required: true, store }),
  ).toBe(true);
  expect(store.claimEmailGrant).not.toHaveBeenCalled();
});

test("an unverified email or a grant linked to another account gives no access", async () => {
  grants.push({ id: "g1", email: "tester@example.com", userId: null });
  expect(await hasBetaAccess({ ...tester, emailVerified: false }, { required: true, store })).toBe(
    false,
  );
  grants[0]!.userId = "u2";
  expect(await hasBetaAccess(tester, { required: true, store })).toBe(false);
  expect(grants[0]?.userId).toBe("u2");
});

test("granted users are cached for a minute; refusals are not", async () => {
  expect(await hasBetaAccess(tester, { required: true, store, now: 0 })).toBe(false);
  grants.push({ id: "g1", email: "tester@example.com", userId: null });
  expect(await hasBetaAccess(tester, { required: true, store, now: 1 })).toBe(true);
  grants.length = 0;
  vi.mocked(store.hasUserGrant).mockClear();
  expect(await hasBetaAccess(tester, { required: true, store, now: 30_000 })).toBe(true);
  expect(store.hasUserGrant).not.toHaveBeenCalled();
  expect(await hasBetaAccess(tester, { required: true, store, now: 61_000 })).toBe(false);
});

test.each([
  ["/api/trpc/chat.getChats", true],
  ["/api/chat", true],
  ["/api/chat/stop", true],
  ["/api/run/threads", true],
  ["/api/attachments/abc", true],
  ["/api/upload-attachment", true],
  ["/api/ads/campaigns", true],
  ["/api/device-auth", true],
  ["/api/some-new-endpoint", true],
  ["/new/hello", true],
  ["/api/auth/get-session", false],
  ["/api/auth/sign-out", false],
  ["/api/stripe/webhook", false],
  ["/api/cron/guest-cleanup", false],
  ["/api/status/models", false],
  ["/api/integrations/deni-run/usage", false],
  ["/api/ads", false],
  ["/api/ads/view", false],
  ["/api/ads/click", false],
  ["/chat", false],
  ["/home", false],
  ["/_serverFn/abc", false],
])("%s is gated: %s", (path, gated) => {
  expect(isBetaGatedServerPath(path)).toBe(gated);
});

test("only the anonymous sign-in endpoint counts as guest sign-in", () => {
  expect(isGuestSignInPath("/api/auth/sign-in/anonymous")).toBe(true);
  expect(isGuestSignInPath("/api/auth/sign-in/email")).toBe(false);
});

function gate({ required = true, access = false, signedIn = true } = {}) {
  const getSession = vi.fn(async () =>
    signedIn ? { user: { id: "u1", email: "a@example.com", emailVerified: true } } : null,
  );
  const hasAccess = vi.fn(async () => access);
  return { run: createBetaAccessGate({ required, getSession, hasAccess }), getSession, hasAccess };
}

const withSession = (path: string, init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, {
    ...init,
    headers: { cookie: "better-auth.session_token=abc", ...init.headers },
  });

test("a signed-in user without access gets 403 beta_access_required from gated API routes", async () => {
  const { run } = gate();
  for (const path of ["/api/trpc/chat.getChats", "/api/chat", "/api/run/threads"]) {
    const response = await run(withSession(path, { method: "POST" }));
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ code: "beta_access_required" });
  }
});

test("a native client's bearer token is gated like a session cookie", async () => {
  const withToken = (path: string) =>
    new Request(`http://localhost${path}`, { headers: { authorization: "Bearer desktop-token" } });
  const denied = gate();
  const response = await denied.run(withToken("/api/client/v1/bootstrap"));
  expect(response?.status).toBe(403);
  expect(denied.getSession).toHaveBeenCalledTimes(1);
  expect(await gate({ access: true }).run(withToken("/api/client/v1/chats"))).toBeNull();
});

test("a /new navigation without access goes to the private beta screen", async () => {
  const response = await gate().run(withSession("/new/hello"));
  expect(response?.status).toBe(307);
  expect(response?.headers.get("location")).toBe("http://localhost/private-beta");
});

test("invited users, open routes, signed-out requests and a gate that is off pass through", async () => {
  expect(await gate({ access: true }).run(withSession("/api/chat"))).toBeNull();
  const open = gate();
  expect(await open.run(withSession("/api/auth/get-session"))).toBeNull();
  expect(open.getSession).not.toHaveBeenCalled();
  const signedOut = gate();
  expect(await signedOut.run(new Request("http://localhost/api/chat"))).toBeNull();
  expect(signedOut.getSession).not.toHaveBeenCalled();
  expect(await gate({ signedIn: false }).run(withSession("/api/chat"))).toBeNull();
  expect(await gate({ required: false }).run(withSession("/api/chat"))).toBeNull();
});

test("guest sign-in is refused while the gate is on", async () => {
  const request = () =>
    new Request("http://localhost/api/auth/sign-in/anonymous", { method: "POST" });
  expect((await gate().run(request()))?.status).toBe(403);
  expect(await gate({ required: false }).run(request())).toBeNull();
});

test("with BETA_ACCESS_PAID_PLANS, a paying account gets in without an invitation", async () => {
  const isPaying = vi.fn(async (userId: string) => userId === "u2");
  const subscriber = { id: "u2", email: "payer@example.com", emailVerified: true };
  expect(
    await hasBetaAccess(subscriber, { required: true, store, paidPlans: true, isPaying }),
  ).toBe(true);
  forgetBetaAccess("u2");
  // Off by default: the same account needs an invitation.
  expect(
    await hasBetaAccess(subscriber, { required: true, store, paidPlans: false, isPaying }),
  ).toBe(false);
  expect(isPaying).toHaveBeenCalledTimes(1);
});

test("invited testers and guests never trigger the billing check", async () => {
  const isPaying = vi.fn(async () => true);
  grants.push({ id: "g1", email: "tester@example.com", userId: "u1" });
  expect(await hasBetaAccess(tester, { required: true, store, paidPlans: true, isPaying })).toBe(
    true,
  );
  const guest = { id: "guest", isAnonymous: true };
  expect(await hasBetaAccess(guest, { required: true, store, paidPlans: true, isPaying })).toBe(
    false,
  );
  expect(isPaying).not.toHaveBeenCalled();
});

test("a paid plan is any tier above Free except Go through education", async () => {
  expect(await isOnPaidPlan("u1")).toBe(false);
  plan.tier = "go";
  plan.education = true;
  expect(await isOnPaidPlan("u1")).toBe(false);
  plan.education = false;
  expect(await isOnPaidPlan("u1")).toBe(true);
  plan.tier = "pro";
  expect(await isOnPaidPlan("u1")).toBe(true);
});
