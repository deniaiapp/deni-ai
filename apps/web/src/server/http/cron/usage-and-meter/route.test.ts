import { beforeEach, expect, test, vi } from "vitest";
import { GET } from "./route";

const state = vi.hoisted(() => ({
  env: {
    CRON_SECRET: "s".repeat(32) as string | undefined,
    STRIPE_SECRET_KEY: "test" as string | undefined,
  },
  recovery: vi.fn(),
}));
vi.mock("@/env", () => ({ env: state.env }));
vi.mock("@/lib/usage", () => ({ recoverUsageReservations: state.recovery }));
vi.mock("@/db/drizzle", () => ({ db: {} }));
beforeEach(() => {
  state.env.CRON_SECRET = "s".repeat(32);
  state.env.STRIPE_SECRET_KEY = "test";
  state.recovery.mockReset().mockResolvedValue({ recovered: 0, recoveryFailed: 0 });
});
const request = (authorization?: string) =>
  new Request("http://localhost/api/cron/usage-and-meter", {
    headers: authorization ? { authorization } : {},
  });

test.each([undefined, "Bearer invalid", `Bearer ${"x".repeat(32)}`])(
  "unauthorized workers cannot trigger recovery: %s",
  async (authorization) => {
    expect((await GET(request(authorization))).status).toBe(401);
    expect(state.recovery).not.toHaveBeenCalled();
  },
);
test("recovery is disabled without a configured secret", async () => {
  state.env.CRON_SECRET = undefined;
  expect((await GET(request())).status).toBe(503);
  expect(state.recovery).not.toHaveBeenCalled();
});
test("authenticated workers recover usage without caching the response", async () => {
  state.recovery.mockResolvedValue({ recovered: 2, recoveryFailed: 0 });
  const response = await GET(request(`Bearer ${state.env.CRON_SECRET}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ recovered: 2, recoveryFailed: 0 });
});

test("recovery failures produce a scheduler alert", async () => {
  state.recovery.mockResolvedValue({ recovered: 0, recoveryFailed: 1 });
  expect((await GET(request(`Bearer ${state.env.CRON_SECRET}`))).status).toBe(503);
});

test("nonbilling deployments can still recover abandoned usage", async () => {
  state.env.STRIPE_SECRET_KEY = undefined;
  expect((await GET(request(`Bearer ${state.env.CRON_SECRET}`))).status).toBe(200);
  expect(state.recovery).toHaveBeenCalledOnce();
});
