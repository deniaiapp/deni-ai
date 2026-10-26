import { beforeEach, expect, test, vi } from "vitest";
import { GET, POST } from "./route";

const state = vi.hoisted(() => ({
  env: {
    DENI_RUN_SERVICE_SECRET: "s".repeat(32) as string | undefined,
    NEXT_PUBLIC_BETTER_AUTH_URL: "https://deniai.test",
  },
  account: { isAnonymous: false } as { isAnonymous: boolean } | undefined,
  usage: vi.fn(),
  record: vi.fn(),
}));
vi.mock("@/env", () => ({ env: state.env }));
vi.mock("@/db/drizzle", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (state.account ? [state.account] : []) }),
      }),
    }),
  },
}));
vi.mock("@/lib/product-usage", () => ({
  DENI_RUN_METRICS: ["model", "browser", "computer"],
  getDeniRunUsage: state.usage,
  recordDeniRunUsage: state.record,
}));
beforeEach(() => {
  state.env.DENI_RUN_SERVICE_SECRET = "s".repeat(32);
  state.account = { isAnonymous: false };
  state.usage.mockReset().mockResolvedValue({ tier: "pro", limitUsd: 200, usedUsd: 12.5 });
  state.record.mockReset().mockResolvedValue(undefined);
});
const auth = () => `Bearer ${state.env.DENI_RUN_SERVICE_SECRET}`;
const get = (authorization?: string, query = "?userId=u1") =>
  GET(
    new Request(`http://localhost/api/integrations/deni-run/usage${query}`, {
      headers: authorization ? { authorization } : {},
    }),
  );
const post = (body: unknown, authorization: string | undefined = auth()) =>
  POST(
    new Request("http://localhost/api/integrations/deni-run/usage", {
      method: "POST",
      headers: authorization ? { authorization } : {},
      body: JSON.stringify(body),
    }),
  );

test.each([undefined, "Bearer invalid", `Bearer ${"x".repeat(32)}`])(
  "callers without the service secret can neither read nor spend a budget: %s",
  async (authorization) => {
    expect((await get(authorization)).status).toBe(401);
    expect(
      // "" sends no header (undefined would select the default secret).
      (await post({ userId: "u1", metric: "model", costUsd: 1 }, authorization ?? "")).status,
    ).toBe(401);
    expect(state.usage).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  },
);
test("the integration is disabled without a configured secret", async () => {
  state.env.DENI_RUN_SERVICE_SECRET = undefined;
  expect((await get("Bearer ")).status).toBe(503);
});
test("reads the plan budget of the Deni AI user without caching it", async () => {
  const response = await get(auth());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    userId: "u1",
    tier: "pro",
    usedUsd: 12.5,
    manageUrl: "https://deniai.test/settings/billing",
  });
});
test.each([
  [undefined, 404],
  [{ isAnonymous: true }, 403],
])("unknown and guest accounts have no budget", async (account, status) => {
  state.account = account;
  expect((await get(auth())).status).toBe(status);
  expect((await post({ userId: "u1", metric: "model", costUsd: 1 })).status).toBe(status);
  expect(state.record).not.toHaveBeenCalled();
});
test.each([
  { userId: "u1", metric: "tokens", costUsd: 1 },
  { userId: "u1", metric: "model", costUsd: -1 },
  { userId: "u1", metric: "model", costUsd: 5_000 },
  { metric: "model", costUsd: 1 },
])("rejects invalid reports: %o", async (body) => {
  expect((await post(body)).status).toBe(400);
  expect(state.record).not.toHaveBeenCalled();
});
test("records reported cost and answers with the updated budget", async () => {
  const response = await post({ userId: "u1", metric: "browser", costUsd: 0.25 });
  expect(response.status).toBe(200);
  expect(state.record).toHaveBeenCalledWith({ userId: "u1", metric: "browser", costUsd: 0.25 });
  expect(state.usage).toHaveBeenCalledWith("u1");
});
