import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import type { Hono } from "hono";
import type { AgentAuthContext } from "../middleware/validateAgentAuth";

// Integration: the real /v1 routes and validateAgentAuth (API key, bans, plan,
// reservation) over PostgreSQL/WASM with the real public and flixa migrations.
// Only the upstream provider (fetch) is mocked. FLIXA_USAGE_ENGINE=shared.
process.env.FLIXA_BILLING_CACHE_TTL_MS = "0";
process.env.FLIXA_REQUIRE_CLIENT_SIGNAL = "false";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.FLIXA_USAGE_FINALIZE_ASYNC = "false";
process.env.OPENROUTER_API_KEY = "local-test-key";
process.env.DENI_AI_API_KEY = "deni_local_test_key";
process.env.FLIXA_USAGE_ENGINE = "shared";

const { installUsageTestDb, resetFlixaUsageTables, countLegacyReceipts, eventually } = await import(
  "./helpers/usage-db"
);
const { pglite, db } = await installUsageTestDb();

const {
  readCreditUnits,
  readProductUsage,
  readQuota,
  readReservations,
  seedBilling,
  seedCreditLot,
  seedMemberPolicy,
  seedTeam,
  seedUser,
} = await import("@deniai/billing/testing");
const { createUsageEngine, getUsagePoolUnits, USAGE_RESERVATION_STALE_MS } = await import(
  "@deniai/billing/server"
);
const { Hono: HonoApp } = await import("hono");
const { agentRouter } = await import("../routes/v1/agent");
const { deniRouter } = await import("../routes/v1/deni");
const { hashApiKey } = await import("../utils/deni/auth");
const { reserveFlixaUsage, recordFlixaObservedUsage } = await import("../utils/deni/flixaUsage");
const { runFlixaUsageRecovery } = await import("../utils/deni/usageEngine");
const { finalizeUsage, startUsageLease } = await import("../utils/agent/usageAccounting");
const { UsageEstimate } = await import("../utils/agent/usageEstimation");
const { computeMeteredTokens } = await import("../utils/agent/usageMetering");
const { getModelTokenUsageMultiplier } = await import("../utils/agent/models");

const MODEL = "openai/gpt-6-luna";
const API_KEY = "deni_usage_engine_integration_key";
const USER = "flixa-user";
const FREE_POOL = getUsagePoolUnits("free");
const PRO_POOL = getUsagePoolUnits("pro");
// The web app's engine over the same database: chat usage and the summary it shows.
const web = createUsageEngine({ db });
let app: Hono;
let nextId = 0;

before(() => {
  app = new HonoApp().route("/v1", agentRouter).route("/v1", deniRouter);
});

after(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await resetFlixaUsageTables(pglite);
  await seedUser(pglite, USER);
  await pglite.query(
    `INSERT INTO api_key (user_id, name, key_hash, key_prefix) VALUES ($1, 'test', $2, 'deni_')`,
    [USER, hashApiKey(API_KEY)],
  );
});

/** Deni AI chat spends `amount` of the user's pool. */
async function spendChat(amount: number, userId = USER) {
  const reservationId = `chat-${++nextId}`;
  await web.consumeUsage({ userId, category: "basic", reservationId, amount });
  await web.settleUsage({ userId, reservationId, amount });
}

const BODY = { model: MODEL, input: "hello", stream: true };

async function request(body: object = BODY): Promise<Response> {
  return app.request("/v1/agent/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
}

function sse(events: object[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

const COMPLETED_USAGE = {
  input_tokens: 100,
  output_tokens: 2,
  input_tokens_details: { cached_tokens: 80 },
};
const COMPLETED = [
  { type: "response.output_text.delta", delta: "abcdefgh" },
  { type: "response.completed", response: { usage: COMPLETED_USAGE } },
];

function expectedAmount(usage: object, tier: "free" | "pro" = "free") {
  return Math.ceil(computeMeteredTokens(usage)! * getModelTokenUsageMultiplier(MODEL, tier));
}

function withUpstream<T>(
  respond: (init: RequestInit | undefined) => Response,
  run: () => Promise<T>,
): Promise<T> {
  const spy = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) =>
    respond(init),
  );
  return run().finally(() => spy.mock.restore());
}

describe("reserve → stream → settle (shared engine)", () => {
  test("a completed stream settles the metered amount in quota, receipt and Flixa ledger", async () => {
    await withUpstream(
      () => sse(COMPLETED),
      async () => {
        const response = await request();
        assert.equal(response.status, 200);
        assert.ok((await response.text()).includes("response.completed"));
      },
    );
    const amount = expectedAmount(COMPLETED_USAGE);
    assert.deepEqual(await readQuota(pglite, USER), [
      { category: "basic", used: amount, unit: "units", planTier: "free" },
    ]);
    const [reservation] = await readReservations(pglite, USER);
    assert.equal(reservation?.product, "flixa");
    assert.ok(reservation?.id.startsWith("flixa:"));
    assert.equal(reservation?.settledAmount, amount);
    assert.ok(reservation!.reservedAmount > amount);
    assert.deepEqual(await readProductUsage(pglite, USER), [
      { product: "flixa", metric: "basic", unit: "units", used: amount },
    ]);
    assert.equal(await countLegacyReceipts(pglite), 0);
  });

  test("a client abort mid-stream settles the observed input and output", async () => {
    let upstreamSignal: AbortSignal | undefined;
    await withUpstream(
      (init) => {
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
      },
      async () => {
        const response = await request();
        assert.equal(response.status, 200);
        const reader = response.body!.getReader();
        await reader.read();
        await reader.cancel();
        assert.equal(upstreamSignal?.aborted, true);
      },
    );
    const estimate = new UsageEstimate(BODY, MODEL, "responses", "free");
    // "abcdefgh" = 8 bytes = 2 output tokens.
    const amount = expectedAmount({ input_tokens: estimate.inputTokens, output_tokens: 2 });
    await eventually(async () => (await readReservations(pglite, USER))[0]?.settled === true);
    assert.equal((await readQuota(pglite, USER))[0]?.used, amount);
    assert.deepEqual(await readProductUsage(pglite, USER), [
      { product: "flixa", metric: "basic", unit: "units", used: amount },
    ]);
  });

  test("an upstream rejection releases the whole hold", async () => {
    await withUpstream(
      () => new Response("upstream unavailable", { status: 503 }),
      async () => {
        const response = await request();
        assert.equal(response.status, 503);
      },
    );
    assert.equal((await readQuota(pglite, USER))[0]?.used, 0);
    assert.deepEqual(
      (await readReservations(pglite, USER)).map(({ settled, settledAmount }) => ({
        settled,
        settledAmount,
      })),
      [{ settled: true, settledAmount: 0 }],
    );
    assert.deepEqual(await readProductUsage(pglite, USER), []);
  });
});

describe("limits", () => {
  test("an exhausted pool answers 429 with the unchanged contract fields", async () => {
    await spendChat(FREE_POOL - 10);
    const fetchSpy = mock.method(globalThis, "fetch", async () => sse(COMPLETED));
    try {
      const response = await request();
      assert.equal(response.status, 429);
      const body = (await response.json()) as { error: Record<string, unknown> };
      assert.equal(body.error.code, "USAGE_LIMIT_EXCEEDED");
      assert.equal(body.error.type, "quota_exceeded");
      assert.equal(body.error.category, "basic");
      assert.equal(body.error.tier, "free");
      assert.equal(body.error.canVerifyForBoost, true);
      assert.equal(body.error.canUpgrade, true);
      assert.equal(body.error.verifyUrl, "https://deniai.app/settings/billing");
      assert.equal(body.error.upgradeUrl, "https://deniai.app/settings/billing");
      assert.equal(fetchSpy.mock.callCount(), 0);
    } finally {
      fetchSpy.mock.restore();
    }
    // Nothing was held for the refused request.
    assert.equal((await readQuota(pglite, USER))[0]?.used, FREE_POOL - 10);
    assert.equal((await readReservations(pglite, USER)).length, 1);
  });

  test("team usage policy blocks a member past their Max Mode cap", async () => {
    await seedUser(pglite, "owner");
    await seedTeam(pglite, "team", ["owner", USER]);
    await seedBilling(pglite, {
      id: "team-billing",
      userId: "owner",
      organizationId: "team",
      planId: "pro_team_monthly",
      maxModeEnabled: true,
    });
    await seedCreditLot(pglite, { organizationId: "team", units: 100_000_000 });
    await seedMemberPolicy(pglite, { organizationId: "team", userId: USER, maxModeLimit: 1_000 });
    await spendChat(PRO_POOL);
    const response = await withUpstream(() => sse(COMPLETED), () => request());
    assert.equal(response.status, 429);
    const body = (await response.json()) as { error: Record<string, unknown> };
    assert.equal(body.error.tier, "pro");
    assert.equal(body.error.canUpgrade, false);
    assert.equal(await readCreditUnits(pglite, { organizationId: "team" }), 100_000_000);
    // Control: without the member cap the same request runs on the team's credits.
    await pglite.query(
      "UPDATE team_member_usage_policy SET max_mode_limit_basic = NULL WHERE user_id = $1",
      [USER],
    );
    const allowed = await withUpstream(() => sse(COMPLETED), () => request());
    assert.equal(allowed.status, 200);
    await allowed.text();
    assert.ok((await readCreditUnits(pglite, { organizationId: "team" })) < 100_000_000);
  });

  test("Max Mode credits carry a request past an exhausted pool", async () => {
    await seedBilling(pglite, {
      id: "personal",
      userId: USER,
      planId: "pro_monthly",
      maxModeEnabled: true,
    });
    await seedCreditLot(pglite, { userId: USER, units: 10_000_000 });
    await spendChat(PRO_POOL - 10);
    await withUpstream(
      () => sse(COMPLETED),
      async () => {
        const response = await request();
        assert.equal(response.status, 200);
        await response.text();
      },
    );
    const amount = expectedAmount(COMPLETED_USAGE, "pro");
    const flixa = (await readReservations(pglite, USER)).find((r) => r.product === "flixa");
    assert.equal(flixa?.settledAmount, amount);
    // Only the part past the pool spends credits.
    assert.equal(flixa?.maxModeAmount, amount - 10);
    assert.equal(await readCreditUnits(pglite, { userId: USER }), 10_000_000 - (amount - 10));
    assert.equal((await readQuota(pglite, USER))[0]?.used, PRO_POOL + amount - 10);
  });
});

describe("recovery", () => {
  test("a reservation left by a crashed request is recovered at its observed amount", async () => {
    const reserved = await reserveFlixaUsage({
      userId: USER,
      category: "basic",
      tier: "free",
      hasVerifiedPaymentMethod: false,
      amount: 5_000,
    });
    assert.equal(reserved.reservation?.engine, "shared");
    // The request's heartbeat persisted 1,200 units before the process died.
    await recordFlixaObservedUsage(reserved.reservation!, 1_200);
    assert.deepEqual(await runFlixaUsageRecovery(new Date()), { recovered: 0, recoveryFailed: 0 });
    const later = new Date(Date.now() + USAGE_RESERVATION_STALE_MS + 60_000);
    assert.deepEqual(await runFlixaUsageRecovery(later), { recovered: 1, recoveryFailed: 0 });
    assert.equal((await readQuota(pglite, USER))[0]?.used, 1_200);
    assert.deepEqual(await readProductUsage(pglite, USER), [
      { product: "flixa", metric: "basic", unit: "units", used: 1_200 },
    ]);
  });
});

describe("observed-usage heartbeat", () => {
  test("a running request persists its observed usage every 30 s until it settles", async () => {
    const estimate = new UsageEstimate(BODY, MODEL, "responses", "free");
    const reserved = await reserveFlixaUsage({
      userId: USER,
      category: "basic",
      tier: "free",
      hasVerifiedPaymentMethod: false,
      amount: estimate.reservationAmount,
    });
    const auth: AgentAuthContext = {
      userId: USER,
      modelId: MODEL,
      tier: "free",
      modelCategory: "basic",
      usageUnit: "units",
      usageReserved: true,
      usageReservation: reserved.reservation,
      usageEstimate: estimate,
      hasVerifiedPaymentMethod: false,
      tokenUsageMultiplier: getModelTokenUsageMultiplier(MODEL, "free"),
      usageMeteringEnabled: true,
    };
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      startUsageLease(auth);
      estimate.observe({ type: "response.output_text.delta", delta: "abcdefgh" });
      mock.timers.tick(30_000);
      const observed = expectedAmount({ input_tokens: estimate.inputTokens, output_tokens: 2 });
      await eventually(async () => (await readReservations(pglite, USER))[0]?.observedAmount === observed);
      await finalizeUsage(auth, { input_tokens: 10, output_tokens: 1 });
      assert.equal(auth.stopUsageLease, undefined);
      estimate.observe({ type: "response.output_text.delta", delta: "more output" });
      mock.timers.tick(60_000);
      const [reservation] = await readReservations(pglite, USER);
      assert.equal(reservation?.settled, true);
      assert.equal(reservation?.observedAmount, observed);
    } finally {
      mock.timers.reset();
    }
  });
});

describe("GET /v1/deni/usage", () => {
  test("reports the pool the web app shows, including chat, Flixa and Deni Run", async () => {
    await spendChat(3_000);
    await withUpstream(
      () => sse(COMPLETED),
      async () => {
        await (await request()).text();
      },
    );
    await pglite.query(
      `INSERT INTO product_usage (user_id, product, metric, unit, period_start, used)
       VALUES ($1, 'run', 'model', 'usd_micros',
         date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 500)`,
      [USER],
    );
    const response = await app.request("/v1/deni/usage", {
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    assert.equal(response.status, 200);
    const info = (await response.json()) as {
      tier: string;
      pool: { limit: number; used: number; remaining: number };
      usage: { category: string; limit: number; used: number; remaining: number }[];
    };
    const summary = await web.getUsageSummary({ userId: USER });
    const used = summary.pool!.used.chat + summary.pool!.used.flixa + summary.pool!.used.run;
    assert.equal(summary.pool!.used.flixa, expectedAmount(COMPLETED_USAGE));
    assert.equal(summary.pool!.used.run, 1_000);
    assert.equal(info.tier, summary.tier);
    assert.deepEqual(
      { limit: info.pool.limit, used: info.pool.used, remaining: info.pool.remaining },
      { limit: summary.pool!.limit, used, remaining: summary.usage[0]!.remaining },
    );
    assert.deepEqual(
      info.usage.map(({ category, limit, used: entryUsed }) => ({ category, limit, used: entryUsed })),
      [
        { category: "basic", limit: FREE_POOL, used },
        { category: "premium", limit: FREE_POOL, used },
      ],
    );
  });
});
