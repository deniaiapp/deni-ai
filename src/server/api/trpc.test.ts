import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ captureException: vi.fn(), calls: 0 }));
vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@sentry/nextjs", () => ({ captureException: mocks.captureException }));
vi.mock("@/server/api/root", async () => {
  const { publicProcedure, router } = await import("./trpc");
  return {
    appRouter: router({
      ping: publicProcedure.query(() => {
        mocks.calls++;
        return "pong";
      }),
      failingQuery: publicProcedure.query(() => {
        throw new Error('Failed query: select "secret" from "chats"\nparams: private-value');
      }),
      cardDeclined: publicProcedure.mutation(() => {
        throw Object.assign(new Error("Your card was declined."), {
          type: "StripeCardError",
          statusCode: 402,
        });
      }),
      intentional: publicProcedure.query(() => {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not create the post.",
        });
      }),
    }),
  };
});

// tRPC decides whether to send stacks when the instance is created.
vi.stubEnv("NODE_ENV", "production");
const { GET } = await import("@/app/api/trpc/[trpc]/route");
const { TRPC_MAX_BATCH_SIZE } = await import("@/lib/trpc/limits");

async function get(path: string) {
  const response = await GET(new Request(`http://localhost/api/trpc/${path}`));
  return { status: response.status, text: await response.text() };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  mocks.calls = 0;
  mocks.captureException.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("a batch above the cap is rejected before any call runs", async () => {
  const paths = (count: number) => Array.from({ length: count }, () => "ping").join(",");

  const allowed = await get(`${paths(TRPC_MAX_BATCH_SIZE)}?batch=1`);
  expect(allowed.status).toBe(200);
  expect(mocks.calls).toBe(TRPC_MAX_BATCH_SIZE);

  mocks.calls = 0;
  const rejected = await get(`${paths(TRPC_MAX_BATCH_SIZE + 1)}?batch=1`);
  expect(rejected.status).toBe(400);
  expect(mocks.calls).toBe(0);
});

test("unexpected errors reach production clients without SQL or parameters, and are reported", async () => {
  const { status, text } = await get("failingQuery");
  expect(status).toBe(500);
  expect(text).not.toContain("Failed query");
  expect(text).not.toContain("private-value");
  expect(JSON.parse(text).error.json.message).toBe("INTERNAL_SERVER_ERROR");
  expect(mocks.captureException).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining("Failed query") }),
    { tags: { trpcPath: "failingQuery" } },
  );
  expect(console.error).toHaveBeenCalled();
});

test("intentional server errors keep their message", async () => {
  const { status, text } = await get("intentional");
  expect(status).toBe(500);
  expect(JSON.parse(text).error.json.message).toBe("Could not create the post.");
});

test("Stripe card declines keep their customer-facing message", async () => {
  const { POST } = await import("@/app/api/trpc/[trpc]/route");
  const response = await POST(
    new Request("http://localhost/api/trpc/cardDeclined", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  expect(JSON.parse(await response.text()).error.json.message).toBe("Your card was declined.");
});

test("development keeps the original message for debugging", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const { text } = await get("failingQuery");
  expect(JSON.parse(text).error.json.message).toContain("Failed query");
});
