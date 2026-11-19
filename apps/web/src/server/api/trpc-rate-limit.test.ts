import { expect, test, vi } from "vitest";
import type { Context } from "./trpc";

vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: {} }));

const { protectedProcedure, rateLimited, router, TRPC_RATE_LIMITS } = await import("./trpc");

const state = vi.hoisted(() => ({ resolved: 0, parsed: 0 }));

const limit = { windowMs: 60_000, maxRequests: 3 };
const testRouter = router({
  read: protectedProcedure
    .use(rateLimited("test.read", limit))
    .input((value: unknown) => {
      state.parsed++;
      return value as { id: string };
    })
    .query(() => {
      state.resolved++;
      return "ok";
    }),
  other: protectedProcedure.use(rateLimited("test.other", limit)).query(() => "ok"),
});

const caller = (userId: string | null) =>
  testRouter.createCaller({
    db: {} as Context["db"],
    session: userId ? ({ session: { userId } } as Context["session"]) : null,
  });

test("refuses calls past the limit with the localized message", async () => {
  const user = caller("limit-user");
  for (let index = 0; index < limit.maxRequests; index++) {
    await expect(user.read({ id: "a" })).resolves.toBe("ok");
  }
  await expect(user.read({ id: "a" })).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
    message: "Too many requests. Please try again later.",
  });
});

test("a refused call never parses its input or runs its resolver", async () => {
  const user = caller("parse-user");
  for (let index = 0; index < limit.maxRequests; index++) await user.read({ id: "a" });
  state.parsed = 0;
  state.resolved = 0;

  await expect(user.read({ id: "a" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect(state.parsed).toBe(0);
  expect(state.resolved).toBe(0);
});

test("each user has their own allowance", async () => {
  const first = caller("first-user");
  for (let index = 0; index < limit.maxRequests; index++) await first.read({ id: "a" });
  await expect(first.read({ id: "a" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

  await expect(caller("second-user").read({ id: "a" })).resolves.toBe("ok");
});

test("each procedure has its own allowance", async () => {
  const user = caller("two-procedures");
  for (let index = 0; index < limit.maxRequests; index++) await user.read({ id: "a" });
  await expect(user.read({ id: "a" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

  await expect(user.other()).resolves.toBe("ok");
});

test("concurrent calls, such as one batched request, share the allowance", async () => {
  const user = caller("batched-user");
  const results = await Promise.allSettled(
    Array.from({ length: limit.maxRequests + 2 }, () => user.read({ id: "a" })),
  );
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(limit.maxRequests);
});

test("signed-out callers are refused before any limit is counted", async () => {
  await expect(caller(null).read({ id: "a" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

test("normal UI use stays well below the documented budgets", () => {
  expect(TRPC_RATE_LIMITS.stripeRead).toEqual({ windowMs: 60_000, maxRequests: 30 });
  expect(TRPC_RATE_LIMITS.stripeReadPerEdit).toEqual({ windowMs: 60_000, maxRequests: 60 });
  // /api/chat allows 30 messages a minute and each one refetches the chat list once.
  expect(TRPC_RATE_LIMITS.chatList.maxRequests).toBeGreaterThanOrEqual(2 * 30);
});
