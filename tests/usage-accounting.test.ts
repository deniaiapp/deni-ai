import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import * as database from "../utils/deni/db";
import { reserveUsageQuota, settleUsageQuota } from "../utils/deni/usage";
import { UsageEstimate } from "../utils/agent/usageEstimation";
import { finalizeUsage, releaseReservedUsage } from "../utils/agent/usageAccounting";
import type { AgentAuthContext } from "../middleware/validateAgentAuth";
import * as authMiddleware from "../middleware/validateAgentAuth";
import { Hono } from "hono";

// Executes production SQL in isolated PostgreSQL/WASM. No external DB or keys.
const db = new PGlite();
let poolSpy: ReturnType<typeof spyOn>;
let authSpy: ReturnType<typeof spyOn>;
let app: Hono;
let activeAuth: AgentAuthContext;
const oldAsync = Bun.env.FLIXA_USAGE_FINALIZE_ASYNC;
const oldProviderKey = Bun.env.OPENROUTER_API_KEY;

beforeAll(async () => {
  await db.exec(`CREATE TABLE usage_quota (
    user_id TEXT NOT NULL, category TEXT NOT NULL, plan_tier TEXT NOT NULL,
    limit_amount BIGINT, unit TEXT NOT NULL, used BIGINT NOT NULL,
    period_start TIMESTAMPTZ NOT NULL, period_end TIMESTAMPTZ,
    PRIMARY KEY (user_id, category)
  )`);
  poolSpy = spyOn(database, "getDeniPool").mockReturnValue({
    query: (sql: string, values: unknown[]) => db.query(sql, values),
  } as unknown as Pool);
  await reserveUsageQuota("bootstrap", "premium", "free", false, 1);
  authSpy = spyOn(authMiddleware, "validateAgentAuth").mockImplementation(async (c, next) => {
    activeAuth = await authContext();
    c.set("agentAuth", activeAuth);
    await next();
  });
  const { agentRouter } = await import("../routes/v1/agent");
  app = new Hono().route("/v1", agentRouter);
}, 30_000);

beforeEach(async () => {
  Bun.env.FLIXA_USAGE_FINALIZE_ASYNC = "false";
  Bun.env.OPENROUTER_API_KEY = "local-test-key";
  await db.exec("TRUNCATE usage_quota, flixa_usage_reservation");
});

afterAll(async () => {
  poolSpy?.mockRestore();
  authSpy?.mockRestore();
  if (oldAsync === undefined) delete Bun.env.FLIXA_USAGE_FINALIZE_ASYNC;
  else Bun.env.FLIXA_USAGE_FINALIZE_ASYNC = oldAsync;
  if (oldProviderKey === undefined) delete Bun.env.OPENROUTER_API_KEY;
  else Bun.env.OPENROUTER_API_KEY = oldProviderKey;
  await db.close();
});

async function used(): Promise<number> {
  const result = await db.query<{ used: number }>(
    "SELECT used FROM usage_quota WHERE user_id = 'test-user' AND category = 'premium'",
  );
  return Number(result.rows[0]?.used ?? 0);
}

async function authContext(): Promise<AgentAuthContext> {
  const model = "openai/gpt-5.6-luna";
  const estimate = new UsageEstimate(
    { messages: [{ role: "user", content: "hello" }], max_tokens: 100 },
    model,
  );
  const result = await reserveUsageQuota(
    "test-user",
    "premium",
    "free",
    false,
    estimate.reservationAmount,
  );
  expect(result.allowed).toBe(true);
  return {
    userId: "test-user",
    modelId: model,
    modelCategory: "premium",
    tier: "free",
    usageUnit: "tokens",
    usageReserved: true,
    usageReservation: result.reservation,
    usageEstimate: estimate,
    hasVerifiedPaymentMethod: false,
    tokenUsageMultiplier: 1,
    usageMeteringEnabled: true,
  };
}

describe("atomic usage reservations", () => {
  test("remaining 1 token admits only one of 20 requests", async () => {
    await reserveUsageQuota("test-user", "premium", "free", false, 999_999);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveUsageQuota("test-user", "premium", "free", false, 1)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(1);
    expect(await used()).toBe(1_000_000);
  });

  test("concurrent first requests cannot exceed the quota", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        reserveUsageQuota("test-user", "premium", "free", false, 100_000),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(await used()).toBe(1_000_000);
  });

  test("settles differences exactly once, including duplicate concurrent retries", async () => {
    const { reservation } = await reserveUsageQuota("test-user", "premium", "free", false, 100);
    await Promise.all([settleUsageQuota(reservation!, 30), settleUsageQuota(reservation!, 30)]);
    expect(await used()).toBe(30);
    const second = await reserveUsageQuota("test-user", "premium", "free", false, 100);
    await settleUsageQuota(second.reservation!, 200);
    expect(await used()).toBe(230);
  });

  test("pre-response errors refund reservations", async () => {
    const auth = await authContext();
    await releaseReservedUsage(auth);
    await releaseReservedUsage(auth);
    expect(await used()).toBe(0);
  });

  test("old receipts cannot subtract from a new month", async () => {
    const old = await reserveUsageQuota("test-user", "premium", "free", false, 100);
    await db.exec("UPDATE usage_quota SET period_end = '2000-01-01'");
    await reserveUsageQuota("test-user", "premium", "free", false, 80);
    await settleUsageQuota(old.reservation!, 0);
    expect(await used()).toBe(80);
  });

  test("old receipts cannot subtract from a new tier", async () => {
    const old = await reserveUsageQuota("test-user", "premium", "free", false, 100);
    await reserveUsageQuota("test-user", "premium", "plus", false, 80);
    await settleUsageQuota(old.reservation!, 0);
    expect(await used()).toBe(80);
  });

  test("receipt creation failure rolls back the quota debit", async () => {
    await reserveUsageQuota("test-user", "premium", "free", false, 100);
    await db.exec(
      "ALTER TABLE flixa_usage_reservation ADD CONSTRAINT test_fail CHECK (amount < 150)",
    );
    try {
      await expect(reserveUsageQuota("test-user", "premium", "free", false, 200)).rejects.toThrow();
      expect(await used()).toBe(100);
    } finally {
      await db.exec("ALTER TABLE flixa_usage_reservation DROP CONSTRAINT test_fail");
    }
  });
});

describe("stream accounting", () => {
  test("only forwarded output limits can reduce the reservation", () => {
    const model = "openai/gpt-5.6-luna";
    const body = { max_tokens: 1000, max_output_tokens: 1, max_completion_tokens: 1 };
    expect(new UsageEstimate(body, model, "chat").reservationAmount).toBe(
      new UsageEstimate({ max_tokens: 1000 }, model).reservationAmount,
    );
    expect(new UsageEstimate(body, model, "messages").reservationAmount).toBe(
      new UsageEstimate({ max_tokens: 1000 }, model).reservationAmount,
    );
    expect(new UsageEstimate(body, model, "responses").reservationAmount).toBeLessThan(
      new UsageEstimate(body, model, "chat").reservationAmount,
    );
    expect(new UsageEstimate(body, model, "compact").reservationAmount).toBeGreaterThan(
      new UsageEstimate(body, model, "chat").reservationAmount,
    );
  });

  test("disconnect before usage arrives charges observed text and input", async () => {
    const auth = await authContext();
    auth.usageEstimate!.observe({ choices: [{ delta: { content: "abcdefgh" } }] });
    await finalizeUsage(auth, {}, false);
    expect(await used()).toBe(auth.usageEstimate!.inputTokens + 2 * 5);
    await releaseReservedUsage(auth);
    expect(await used()).toBe(auth.usageEstimate!.inputTokens + 2 * 5);
  });

  test("Anthropic interruption preserves cache reads and estimates partial output", async () => {
    const auth = await authContext();
    auth.usageEstimate!.observe({ type: "content_block_delta", delta: { text: "a".repeat(80) } });
    await finalizeUsage(
      auth,
      { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 1 },
      false,
    );
    expect(await used()).toBe(210);
  });

  test("actual completion usage wins over fallback estimates", async () => {
    const auth = await authContext();
    auth.usageEstimate!.observe({ choices: [{ delta: { content: "a".repeat(400) } }] });
    const usage = { prompt_tokens: 10, completion_tokens: 2 };
    auth.usageEstimate!.observe({ choices: [], usage });
    await finalizeUsage(auth, usage, false);
    expect(await used()).toBe(20);
  });

  test("valid zero usage refunds the full hold", async () => {
    const auth = await authContext();
    await finalizeUsage(auth, { input_tokens: 0, output_tokens: 0 });
    expect(await used()).toBe(0);
  });

  test("tracks tool arguments and reasoning without counting protocol bytes", () => {
    const estimate = new UsageEstimate({}, "openai/gpt-5.6-luna");
    estimate.observe({ type: "response.function_call_arguments.delta", delta: "abcd" });
    estimate.observe({ type: "content_block_delta", delta: { thinking: "efgh" } });
    estimate.observe({
      choices: [{ delta: { tool_calls: [{ function: { arguments: "ijkl" } }] } }],
    });
    estimate.observe({ type: "response.created", response: { id: "ignored" } });
    expect(estimate.outputTokens).toBe(3);
  });
});

function mockFetch(implementation: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  return spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(implementation, {
      preconnect: globalThis.fetch.preconnect,
    }),
  );
}

describe("Responses route streaming", () => {
  async function request() {
    return app.request("/v1/agent/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-5.6-luna", input: "hello", stream: true }),
    });
  }

  test("client cancellation aborts upstream and charges streamed deltas without usage", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const fetchSpy = mockFetch(async (_url, init) => {
      upstreamSignal = init?.signal as AbortSignal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"response.output_text.delta","delta":"abcdefgh"}\n\n',
              ),
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    try {
      const response = await request();
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const chunk = await reader.read();
      expect(new TextDecoder().decode(chunk.value)).toContain("abcdefgh");
      await reader.cancel();
      expect(upstreamSignal?.aborted).toBe(true);
      expect(await used()).toBe(activeAuth.usageEstimate!.inputTokens + 10);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("upstream stream errors charge already observed deltas instead of refunding", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const fetchSpy = mockFetch(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              controller = c;
              c.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"response.function_call_arguments.delta","delta":"abcdefgh"}\n\n',
                ),
              );
            },
          }),
        ),
    );
    try {
      const response = await request();
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      await reader.read();
      controller!.error(new Error("local simulated upstream disconnect"));
      await expect(reader.read()).rejects.toThrow("local simulated upstream disconnect");
      expect(await used()).toBe(activeAuth.usageEstimate!.inputTokens + 10);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("successful SSE completion settles to authoritative cached-token usage", async () => {
    const events = [
      { type: "response.output_text.delta", delta: "abcdefgh" },
      {
        type: "response.completed",
        response: {
          usage: {
            input_tokens: 100,
            output_tokens: 2,
            input_tokens_details: { cached_tokens: 80 },
          },
        },
      },
    ];
    const fetchSpy = mockFetch(
      async () =>
        new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")),
    );
    try {
      const response = await request();
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("response.completed");
      expect(await used()).toBe(38);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("upstream HTTP rejection refunds the hold", async () => {
    const fetchSpy = mockFetch(async () => new Response("upstream unavailable", { status: 503 }));
    try {
      const response = await request();
      expect(response.status).toBe(503);
      expect(await used()).toBe(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
