import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import type { AgentAuthContext } from "../middleware/validateAgentAuth";
import { Hono } from "hono";

// Swap getDeniPool and validateAgentAuth for mocks before any module that
// imports them is loaded.
const database = await import("../utils/deni/db");
const getDeniPool = mock.fn(database.getDeniPool);
mock.module("../utils/deni/db", { exports: { ...database, getDeniPool } });
const authMiddleware = await import("../middleware/validateAgentAuth");
const validateAgentAuth = mock.fn(authMiddleware.validateAgentAuth);
mock.module("../middleware/validateAgentAuth", {
  exports: { ...authMiddleware, validateAgentAuth },
});
const { reserveUsageQuota, settleUsageQuota } = await import("../utils/deni/usage");
const { UsageEstimate } = await import("../utils/agent/usageEstimation");
const { finalizeUsage, releaseReservedUsage } = await import("../utils/agent/usageAccounting");

// Executes production SQL in isolated PostgreSQL/WASM. No external DB or keys.
const db = new PGlite();
let app: Hono;
let activeAuth: AgentAuthContext;
const oldAsync = process.env.FLIXA_USAGE_FINALIZE_ASYNC;
const oldProviderKey = process.env.OPENROUTER_API_KEY;
const oldDeniKey = process.env.DENI_AI_API_KEY;

before(async () => {
  await db.exec(`CREATE TABLE usage_quota (
    user_id TEXT NOT NULL, category TEXT NOT NULL, plan_tier TEXT NOT NULL,
    limit_amount BIGINT, unit TEXT NOT NULL, used BIGINT NOT NULL,
    period_start TIMESTAMPTZ NOT NULL, period_end TIMESTAMPTZ,
    PRIMARY KEY (user_id, category)
  )`);
  // Mirrors deni-ai/src/db/schema/product-usage.ts.
  await db.exec(`CREATE TABLE product_usage (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL, product TEXT NOT NULL, metric TEXT NOT NULL, unit TEXT NOT NULL,
    period_start TIMESTAMPTZ NOT NULL, used BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db.exec(
    "CREATE UNIQUE INDEX product_usage_user_period_idx ON product_usage (user_id, product, metric, unit, period_start)",
  );
  await db.exec("CREATE TABLE signup_risk (user_id TEXT PRIMARY KEY)");
  const pool = {
    query: (sql: string, values: unknown[]) => db.query(sql, values),
  } as unknown as Pool;
  getDeniPool.mock.mockImplementation(() => pool);
  await reserveUsageQuota("bootstrap", "premium", "free", false, 1);
  validateAgentAuth.mock.mockImplementation(async (c, next) => {
    activeAuth = await authContext();
    c.set("agentAuth", activeAuth);
    await next();
  });
  const { agentRouter } = await import("../routes/v1/agent");
  app = new Hono().route("/v1", agentRouter);
}, { timeout: 30_000 });

beforeEach(async () => {
  process.env.FLIXA_USAGE_FINALIZE_ASYNC = "false";
  process.env.OPENROUTER_API_KEY = "local-test-key";
  process.env.DENI_AI_API_KEY = "deni_local_test_key";
  await db.exec("TRUNCATE usage_quota, flixa_usage_reservation, product_usage");
});

after(async () => {
  getDeniPool.mock.restore();
  validateAgentAuth.mock.restore();
  if (oldAsync === undefined) delete process.env.FLIXA_USAGE_FINALIZE_ASYNC;
  else process.env.FLIXA_USAGE_FINALIZE_ASYNC = oldAsync;
  if (oldProviderKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = oldProviderKey;
  if (oldDeniKey === undefined) delete process.env.DENI_AI_API_KEY;
  else process.env.DENI_AI_API_KEY = oldDeniKey;
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
  assert.equal(result.allowed, true);
  return {
    userId: "test-user",
    modelId: model,
    modelCategory: "premium",
    tier: "free",
    usageUnit: "units",
    usageReserved: true,
    usageReservation: result.reservation,
    usageEstimate: estimate,
    hasVerifiedPaymentMethod: false,
    tokenUsageMultiplier: 1,
    usageMeteringEnabled: true,
  };
}

describe("atomic usage reservations", () => {
  // The Free pool is $10 = 20M units, shared with basic usage and Deni Run.
  test("remaining 1 token admits only one of 20 requests", async () => {
    await reserveUsageQuota("test-user", "premium", "free", false, 19_999_999);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveUsageQuota("test-user", "premium", "free", false, 1)),
    );
    assert.equal(results.filter((r) => r.allowed).length, 1);
    assert.equal(await used(), 20_000_000);
  });

  test("concurrent first requests cannot exceed the quota", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        reserveUsageQuota("test-user", "premium", "free", false, 2_000_000),
      ),
    );
    assert.equal(results.filter((r) => r.allowed).length, 10);
    assert.equal(await used(), 20_000_000);
  });

  test("basic usage and Deni Run spend the same pool", async () => {
    await reserveUsageQuota("test-user", "basic", "free", false, 10_000_000);
    // $2.50 of Deni Run = 5M units.
    await db.exec(`INSERT INTO product_usage (user_id, product, metric, unit, period_start, used)
      VALUES ('test-user', 'run', 'model', 'usd_micros',
        date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 2500000)`);
    assert.equal(
      (await reserveUsageQuota("test-user", "premium", "free", false, 5_000_001)).allowed,
      false,
    );
    assert.equal(
      (await reserveUsageQuota("test-user", "premium", "free", false, 5_000_000)).allowed,
      true,
    );
  });

  test("settles differences exactly once, including duplicate concurrent retries", async () => {
    const { reservation } = await reserveUsageQuota("test-user", "premium", "free", false, 100);
    await Promise.all([settleUsageQuota(reservation!, 30), settleUsageQuota(reservation!, 30)]);
    assert.equal(await used(), 30);
    const second = await reserveUsageQuota("test-user", "premium", "free", false, 100);
    await settleUsageQuota(second.reservation!, 200);
    assert.equal(await used(), 230);
    // Flixa's share of the shared quota is recorded once per settled receipt.
    const ledger = await db.query<{ product: string; metric: string; unit: string; used: number }>(
      "SELECT product, metric, unit, used FROM product_usage WHERE user_id = 'test-user'",
    );
    assert.deepEqual(ledger.rows.map((row) => ({ ...row, used: Number(row.used) })), [
      { product: "flixa", metric: "premium", unit: "units", used: 230 },
    ]);
  });

  test("pre-response errors refund reservations", async () => {
    const auth = await authContext();
    await releaseReservedUsage(auth);
    await releaseReservedUsage(auth);
    assert.equal(await used(), 0);
  });

  test("old receipts cannot subtract from a new month", async () => {
    const old = await reserveUsageQuota("test-user", "premium", "free", false, 100);
    await db.exec("UPDATE usage_quota SET period_end = '2000-01-01'");
    await reserveUsageQuota("test-user", "premium", "free", false, 80);
    await settleUsageQuota(old.reservation!, 0);
    assert.equal(await used(), 80);
  });

  test("old receipts cannot subtract from a new tier", async () => {
    const old = await reserveUsageQuota("test-user", "premium", "free", false, 100);
    await reserveUsageQuota("test-user", "premium", "plus", false, 80);
    await settleUsageQuota(old.reservation!, 0);
    assert.equal(await used(), 80);
  });

  test("a legacy-unit quota row is reset and stored in units", async () => {
    await db.exec(`INSERT INTO usage_quota
      (user_id, category, plan_tier, limit_amount, unit, used, period_start, period_end)
      VALUES ('test-user', 'premium', 'free', 20000000, 'tokens', 19999999, NOW(), NOW() + INTERVAL '1 day')`);
    const result = await reserveUsageQuota("test-user", "premium", "free", false, 80);
    assert.equal(result.allowed, true);
    assert.equal(result.unit, "units");
    assert.equal(await used(), 80);
    const row = await db.query<{ unit: string }>(
      "SELECT unit FROM usage_quota WHERE user_id = 'test-user' AND category = 'premium'",
    );
    assert.equal(row.rows[0]?.unit, "units");
  });

  test("receipt creation failure rolls back the quota debit", async () => {
    await reserveUsageQuota("test-user", "premium", "free", false, 100);
    await db.exec(
      "ALTER TABLE flixa_usage_reservation ADD CONSTRAINT test_fail CHECK (amount < 150)",
    );
    try {
      await assert.rejects(reserveUsageQuota("test-user", "premium", "free", false, 200));
      assert.equal(await used(), 100);
    } finally {
      await db.exec("ALTER TABLE flixa_usage_reservation DROP CONSTRAINT test_fail");
    }
  });
});

describe("stream accounting", () => {
  test("only forwarded output limits can reduce the reservation", () => {
    const model = "openai/gpt-5.6-luna";
    const body = { max_tokens: 1000, max_output_tokens: 1, max_completion_tokens: 1 };
    assert.equal(
      new UsageEstimate(body, model, "chat").reservationAmount,
      new UsageEstimate({ max_tokens: 1000 }, model).reservationAmount,
    );
    assert.equal(
      new UsageEstimate(body, model, "messages").reservationAmount,
      new UsageEstimate({ max_tokens: 1000 }, model).reservationAmount,
    );
    assert.ok(
      new UsageEstimate(body, model, "responses").reservationAmount < new UsageEstimate(body, model, "chat").reservationAmount,
    );
    assert.ok(
      new UsageEstimate(body, model, "compact").reservationAmount > new UsageEstimate(body, model, "chat").reservationAmount,
    );
  });

  test("disconnect before usage arrives charges observed text and input", async () => {
    const auth = await authContext();
    auth.usageEstimate!.observe({ choices: [{ delta: { content: "abcdefgh" } }] });
    await finalizeUsage(auth, {}, false);
    assert.equal(await used(), auth.usageEstimate!.inputTokens + 2 * 5);
    await releaseReservedUsage(auth);
    assert.equal(await used(), auth.usageEstimate!.inputTokens + 2 * 5);
  });

  test("Anthropic interruption preserves cache reads and estimates partial output", async () => {
    const auth = await authContext();
    auth.usageEstimate!.observe({ type: "content_block_delta", delta: { text: "a".repeat(80) } });
    await finalizeUsage(
      auth,
      { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 1 },
      false,
    );
    assert.equal(await used(), 210);
  });

  test("actual completion usage wins over fallback estimates", async () => {
    const auth = await authContext();
    auth.usageEstimate!.observe({ choices: [{ delta: { content: "a".repeat(400) } }] });
    const usage = { prompt_tokens: 10, completion_tokens: 2 };
    auth.usageEstimate!.observe({ choices: [], usage });
    await finalizeUsage(auth, usage, false);
    assert.equal(await used(), 20);
  });

  test("valid zero usage refunds the full hold", async () => {
    const auth = await authContext();
    await finalizeUsage(auth, { input_tokens: 0, output_tokens: 0 });
    assert.equal(await used(), 0);
  });

  test("tracks tool arguments and reasoning without counting protocol bytes", () => {
    const estimate = new UsageEstimate({}, "openai/gpt-5.6-luna");
    estimate.observe({ type: "response.function_call_arguments.delta", delta: "abcd" });
    estimate.observe({ type: "content_block_delta", delta: { thinking: "efgh" } });
    estimate.observe({
      choices: [{ delta: { tool_calls: [{ function: { arguments: "ijkl" } }] } }],
    });
    estimate.observe({ type: "response.created", response: { id: "ignored" } });
    assert.equal(estimate.outputTokens, 3);
  });
});

function mockFetch(implementation: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  return mock.method(globalThis, "fetch", implementation);
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
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();
      const chunk = await reader.read();
      assert.ok(new TextDecoder().decode(chunk.value).includes("abcdefgh"));
      await reader.cancel();
      assert.equal(upstreamSignal?.aborted, true);
      assert.equal(await used(), activeAuth.usageEstimate!.inputTokens + 10);
    } finally {
      fetchSpy.mock.restore();
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
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();
      await reader.read();
      controller!.error(new Error("local simulated upstream disconnect"));
      await assert.rejects(
        reader.read(),
        (error: unknown) => error instanceof Error && error.message.includes("local simulated upstream disconnect"),
      );
      assert.equal(await used(), activeAuth.usageEstimate!.inputTokens + 10);
    } finally {
      fetchSpy.mock.restore();
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
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes("response.completed"));
      assert.equal(await used(), 38);
    } finally {
      fetchSpy.mock.restore();
    }
  });

  test("upstream HTTP rejection refunds the hold", async () => {
    const fetchSpy = mockFetch(async () => new Response("upstream unavailable", { status: 503 }));
    try {
      const response = await request();
      assert.equal(response.status, 503);
      assert.equal(await used(), 0);
    } finally {
      fetchSpy.mock.restore();
    }
  });
});
