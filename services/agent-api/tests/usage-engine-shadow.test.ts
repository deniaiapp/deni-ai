import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, mock, test } from "node:test";

// FLIXA_USAGE_ENGINE=shadow: legacy stays authoritative and is the only writer;
// the shared engine is evaluated as a rolled-back dry run and differences are
// logged as structured warnings. PostgreSQL/WASM with the real migrations.
process.env.FLIXA_BILLING_CACHE_TTL_MS = "0";
process.env.FLIXA_REQUIRE_CLIENT_SIGNAL = "false";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.FLIXA_USAGE_FINALIZE_ASYNC = "false";
process.env.DENI_AI_API_KEY = "deni_local_test_key";
process.env.OPENROUTER_API_KEY = "local-test-key";
process.env.FLIXA_USAGE_ENGINE = "shadow";

const { installUsageTestDb, resetFlixaUsageTables, countLegacyReceipts } = await import(
  "./helpers/usage-db"
);
const { pglite } = await installUsageTestDb();

const {
  readCreditUnits,
  readProductUsage,
  readQuota,
  readReservations,
  seedBilling,
  seedCreditLot,
  seedUser,
} = await import("@deniai/billing/testing");
const { getUsagePoolUnits } = await import("@deniai/billing/server");
const { Hono } = await import("hono");
const { agentRouter } = await import("../routes/v1/agent");
const { hashApiKey } = await import("../utils/deni/auth");
const { reserveFlixaUsage, settleFlixaUsage } = await import("../utils/deni/flixaUsage");

const USER = "shadow-user";
const API_KEY = "deni_usage_engine_shadow_key";
const PRO_POOL = getUsagePoolUnits("pro");
const app = new Hono().route("/v1", agentRouter);
let warn: ReturnType<typeof mock.method<Console, "warn">>;

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
  warn = mock.method(console, "warn", () => {});
});

afterEach(() => {
  warn.mock.restore();
});

/** The structured shadow lines logged so far. */
function shadowEvents(): { event: string; [key: string]: unknown }[] {
  return warn.mock.calls
    .map((call) => call.arguments[0])
    .filter((line): line is string => typeof line === "string" && line.startsWith("{"))
    .map((line) => JSON.parse(line) as { event: string })
    .filter((entry) => entry.event?.startsWith("flixa_usage_shadow"));
}

function reserve(amount: number, tier: "free" | "pro" = "free") {
  return reserveFlixaUsage({
    userId: USER,
    category: "basic",
    tier,
    hasVerifiedPaymentMethod: false,
    amount,
  });
}

describe("shadow mode", () => {
  test("legacy writes once, the dry run writes nothing, and agreement logs nothing", async () => {
    const result = await reserve(1_000);
    assert.equal(result.allowed, true);
    assert.equal(result.reservation?.engine, "legacy");
    assert.equal(await countLegacyReceipts(pglite), 1);
    assert.equal((await readQuota(pglite, USER))[0]?.used, 1_000);
    assert.deepEqual(await readReservations(pglite, USER), []);

    await settleFlixaUsage(result.reservation!, 400);
    assert.equal(await countLegacyReceipts(pglite), 0);
    assert.equal((await readQuota(pglite, USER))[0]?.used, 400);
    assert.deepEqual(await readProductUsage(pglite, USER), [
      { product: "flixa", metric: "basic", unit: "units", used: 400 },
    ]);
    assert.deepEqual(await readReservations(pglite, USER), []);
    assert.deepEqual(shadowEvents(), []);
  });

  test("a request through the routes is charged once", async () => {
    const usage = { input_tokens: 100, output_tokens: 2 };
    const events = [
      { type: "response.output_text.delta", delta: "abcdefgh" },
      { type: "response.completed", response: { usage } },
    ];
    const fetchSpy = mock.method(
      globalThis,
      "fetch",
      async () => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")),
    );
    try {
      const response = await app.request("/v1/agent/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: "openai/gpt-6-luna", input: "hello", stream: true }),
      });
      assert.equal(response.status, 200);
      await response.text();
    } finally {
      fetchSpy.mock.restore();
    }
    const [quota] = await readQuota(pglite, USER);
    const [ledger] = await readProductUsage(pglite, USER);
    assert.ok(quota && quota.used > 0);
    assert.equal(ledger?.used, quota.used);
    assert.equal(await countLegacyReceipts(pglite), 0);
    assert.deepEqual(await readReservations(pglite, USER), []);
    assert.deepEqual(shadowEvents(), []);
  });

  test("a different decision is logged and legacy's answer stands", async () => {
    // Pro with Max Mode credits and a spent pool: shared would allow, legacy refuses.
    await seedBilling(pglite, { id: "pro", userId: USER, planId: "pro_monthly", maxModeEnabled: true });
    await seedCreditLot(pglite, { userId: USER, units: 1_000_000 });
    const filled = await reserve(PRO_POOL, "pro");
    await settleFlixaUsage(filled.reservation!, PRO_POOL);

    const result = await reserve(100, "pro");
    assert.equal(result.allowed, false);
    const [event] = shadowEvents();
    assert.equal(event?.event, "flixa_usage_shadow_mismatch");
    assert.deepEqual(event?.differences, ["allowed", "reservedAmount"]);
    assert.deepEqual(event?.legacy, { allowed: false, reservedAmount: 0, remaining: null });
    assert.deepEqual(event?.shared, {
      allowed: true,
      reservedAmount: 100,
      remaining: 0,
      usedMaxMode: true,
    });
    // Nothing was charged twice, no credits were spent, no shared receipt remains.
    assert.equal((await readQuota(pglite, USER))[0]?.used, PRO_POOL);
    assert.equal(await readCreditUnits(pglite, { userId: USER }), 1_000_000);
    assert.deepEqual(await readReservations(pglite, USER), []);
  });

  test("a failing dry run is reported and never blocks the legacy reservation", async () => {
    // As if the product column's migration had not been applied yet.
    await pglite.exec(
      "ALTER TABLE usage_reservation ADD CONSTRAINT shadow_test_fail CHECK (product <> 'flixa')",
    );
    try {
      const result = await reserve(500);
      assert.equal(result.allowed, true);
      assert.equal((await readQuota(pglite, USER))[0]?.used, 500);
      const [event] = shadowEvents();
      assert.equal(event?.event, "flixa_usage_shadow_error");
      assert.match(String(event?.error), /shadow_test_fail|check constraint/);
    } finally {
      await pglite.exec("ALTER TABLE usage_reservation DROP CONSTRAINT shadow_test_fail");
    }
  });
});
