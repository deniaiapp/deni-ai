import { beforeEach, expect, test, vi } from "vitest";
import type { BetaTester } from "@/lib/beta-access-store";

const state = vi.hoisted(() => ({ testers: [] as BetaTester[], nextId: 1 }));
vi.mock("@/env", () => ({
  env: { ADMIN_EMAILS: "ops@example.com", BETA_ACCESS_REQUIRED: true },
}));
vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/beta-access-store", () => ({
  betaAccessStore: {
    hasUserGrant: vi.fn(async (userId: string) => state.testers.some((t) => t.userId === userId)),
    claimEmailGrant: vi.fn(async () => false),
    list: vi.fn(async () => state.testers.map((tester) => ({ ...tester }))),
    add: vi.fn(async ({ email, note, grantedBy }) => {
      if (state.testers.some((tester) => tester.email === email)) return null;
      const tester: BetaTester = {
        id: `grant-${state.nextId++}`,
        email,
        userId: null,
        linkedName: null,
        linkedEmail: null,
        grantedById: grantedBy,
        grantedByEmail: "ops@example.com",
        note,
        createdAt: new Date("2026-11-08T00:00:00Z"),
      };
      state.testers.unshift(tester);
      return { id: tester.id, email };
    }),
    remove: vi.fn(async (id: string) => {
      const index = state.testers.findIndex((tester) => tester.id === id);
      if (index < 0) return null;
      const [tester] = state.testers.splice(index, 1);
      return { id: tester!.id, email: tester!.email, userId: tester!.userId };
    }),
  },
}));

const { betaAccessRouter } = await import("./beta-access");
const { hasBetaAccess } = await import("@/lib/beta-access.server");

const admin = { id: "ops", email: "ops@example.com", emailVerified: true, isAnonymous: false };
const member = { id: "u1", email: "member@example.com", emailVerified: true, isAnonymous: false };

function caller(user: typeof admin) {
  return betaAccessRouter.createCaller({
    db: {},
    session: { session: { userId: user.id }, user },
  } as unknown as Parameters<typeof betaAccessRouter.createCaller>[0]);
}

beforeEach(() => {
  state.testers = [];
  state.nextId = 1;
  vi.spyOn(console, "info").mockImplementation(() => {});
});

test("non-admins cannot list, grant or remove testers", async () => {
  const user = caller(member);
  await expect(user.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(user.grant({ email: "x@example.com" })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(user.revoke({ id: "grant-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  // An unverified admin address is not an admin.
  await expect(caller({ ...admin, emailVerified: false }).list()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(state.testers).toEqual([]);
});

test("admins grant by email (lower-cased, with a note) and are recorded as the granter", async () => {
  const ops = caller(admin);
  const added = await ops.grant({ email: "  New.Tester@Example.COM ", note: "Discord" });
  expect(added).toEqual({ id: "grant-1", email: "new.tester@example.com" });
  const { required, testers } = await ops.list();
  expect(required).toBe(true);
  expect(testers).toMatchObject([
    { email: "new.tester@example.com", note: "Discord", grantedById: "ops", userId: null },
  ]);
  expect(console.info).toHaveBeenCalledWith(
    "[beta-access] Beta access granted",
    expect.objectContaining({ adminEmail: "ops@example.com", email: "new.tester@example.com" }),
  );
});

test("granting an email twice is a conflict; invalid emails are rejected", async () => {
  const ops = caller(admin);
  await ops.grant({ email: "a@example.com" });
  await expect(ops.grant({ email: "A@example.com" })).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(ops.grant({ email: "not-an-email" })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
});

test("removing a tester revokes their cached access at once", async () => {
  const ops = caller(admin);
  const { id } = await ops.grant({ email: "member@example.com" });
  state.testers[0]!.userId = member.id;
  expect(await hasBetaAccess(member)).toBe(true);
  await ops.revoke({ id });
  expect(state.testers).toEqual([]);
  expect(await hasBetaAccess(member)).toBe(false);
  await expect(ops.revoke({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
});
