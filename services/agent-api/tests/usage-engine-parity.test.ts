import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import type { ProductUsageRow, QuotaRow } from "@deniai/billing/testing";

// Parity: the same scenarios through FLIXA_USAGE_ENGINE=legacy and =shared over
// PostgreSQL/WASM with the real migrations. Where the behaviour is meant to be
// identical the outcomes must match; the intended differences
// (packages/billing/docs/usage-engine.md) are asserted as differences.
process.env.FLIXA_BILLING_CACHE_TTL_MS = "0";
// The legacy path reads `usage_quota.period_end` (timestamp without time zone)
// through pg's default parser, i.e. in the process's local zone; the shared engine
// reads it through Drizzle as UTC. Production containers run in UTC, where the two
// agree (documented difference). Pin the zone so this suite compares like for like.
process.env.TZ = "UTC";

const { installUsageTestDb, resetFlixaUsageTables, countLegacyReceipts } = await import(
  "./helpers/usage-db"
);
const { pglite, db } = await installUsageTestDb();

const {
  readProductUsage,
  readQuota,
  readReservations,
  seedBilling,
  seedCreditLot,
  seedRunSpend,
  seedUser,
} = await import("@deniai/billing/testing");
const { createUsageEngine, getUsagePoolUnits, USAGE_RESERVATION_STALE_MS } = await import(
  "@deniai/billing/server"
);
const { reserveFlixaUsage, settleFlixaUsage, getSharedDeniUsageInfo } = await import(
  "../utils/deni/flixaUsage"
);
const { getDeniBillingProfile, getDeniUsageInfo } = await import("../utils/deni/usage");
const { runFlixaUsageRecovery } = await import("../utils/deni/usageEngine");

type Mode = "legacy" | "shared";
const MODES: Mode[] = ["legacy", "shared"];
const USER = "parity-user";
const FREE_POOL = getUsagePoolUnits("free");
const PRO_POOL = getUsagePoolUnits("pro");
const web = createUsageEngine({ db });
const originalMode = process.env.FLIXA_USAGE_ENGINE;

after(async () => {
  if (originalMode === undefined) delete process.env.FLIXA_USAGE_ENGINE;
  else process.env.FLIXA_USAGE_ENGINE = originalMode;
  await pglite.close();
});

beforeEach(async () => {
  await resetFlixaUsageTables(pglite);
  await seedUser(pglite, USER);
});

/** Reserve as validateAgentAuth does, with the plan tier from the billing profile. */
async function reserve(mode: Mode, amount: number) {
  process.env.FLIXA_USAGE_ENGINE = mode;
  const profile = await getDeniBillingProfile(USER);
  return reserveFlixaUsage({
    userId: USER,
    category: "basic",
    tier: profile.tier,
    hasVerifiedPaymentMethod: profile.hasVerifiedPaymentMethod,
    amount,
  });
}

async function reserveAndSettle(mode: Mode, amount: number, actual: number) {
  const result = await reserve(mode, amount);
  if (result.reservation) await settleFlixaUsage(result.reservation, actual);
  return result;
}

type Outcome = { decisions: unknown[]; quota: QuotaRow[]; ledger: ProductUsageRow[] };

/** Run a scenario once per mode on a fresh database; returns each mode's outcome. */
async function both(
  setup: () => Promise<void>,
  scenario: (mode: Mode) => Promise<unknown[]>,
): Promise<Record<Mode, Outcome>> {
  const outcomes = {} as Record<Mode, Outcome>;
  for (const mode of MODES) {
    await resetFlixaUsageTables(pglite);
    await seedUser(pglite, USER);
    await setup();
    const decisions = await scenario(mode);
    outcomes[mode] = {
      decisions,
      quota: (await readQuota(pglite, USER)).map((row) => ({ ...row, planTier: "-" })),
      ledger: await readProductUsage(pglite, USER),
    };
  }
  return outcomes;
}

const decision = (result: { allowed: boolean; remaining: number }) => ({
  allowed: result.allowed,
  remaining: result.allowed ? result.remaining : null,
});

describe("identical outcomes", () => {
  test("reserve, settle and refund write the same quota and Flixa ledger", async () => {
    const outcome = await both(
      async () => {},
      async (mode) => [
        decision(await reserveAndSettle(mode, 1_000, 300)),
        decision(await reserveAndSettle(mode, 2_000, 0)),
        decision(await reserveAndSettle(mode, 500, 900)),
      ],
    );
    assert.deepEqual(outcome.shared, outcome.legacy);
    assert.deepEqual(outcome.shared.quota, [
      { category: "basic", used: 1_200, unit: "units", planTier: "-" },
    ]);
    assert.deepEqual(outcome.shared.ledger, [
      { product: "flixa", metric: "basic", unit: "units", used: 1_200 },
    ]);
  });

  test("the pool edge, Deni Run and chat usage refuse the same requests", async () => {
    const outcome = await both(
      async () => {
        await seedRunSpend(pglite, USER, 1_000_000); // 2M units
        await seedBilling(pglite, { id: "go", userId: USER, planId: "go_monthly" });
      },
      async (mode) => {
        const spent = getUsagePoolUnits("go") - 2_000_000 - 100;
        return [
          decision(await reserveAndSettle(mode, spent, spent)),
          decision(await reserve(mode, 101)),
          decision(await reserve(mode, 100)),
        ];
      },
    );
    assert.deepEqual(outcome.shared.decisions, outcome.legacy.decisions);
    assert.deepEqual(outcome.shared.quota, outcome.legacy.quota);
  });

  test("an exhausted pool refuses without writing in both", async () => {
    const outcome = await both(
      async () => {},
      async (mode) => [
        decision(await reserveAndSettle(mode, FREE_POOL, FREE_POOL - 5)),
        decision(await reserve(mode, 6)),
        decision(await reserve(mode, 5)),
      ],
    );
    assert.deepEqual(outcome.shared, outcome.legacy);
    assert.deepEqual(outcome.shared.decisions.slice(1), [
      { allowed: false, remaining: null },
      { allowed: true, remaining: 0 },
    ]);
  });

  test("concurrent reservations at the edge admit the same number", async () => {
    const outcome = await both(
      async () => {},
      async (mode) => {
        process.env.FLIXA_USAGE_ENGINE = mode;
        const results = await Promise.all(
          Array.from({ length: 12 }, () =>
            reserveFlixaUsage({
              userId: USER,
              category: "basic",
              tier: "free",
              hasVerifiedPaymentMethod: false,
              amount: 2_000_000,
            }),
          ),
        );
        return [results.filter((result) => result.allowed).length];
      },
    );
    assert.deepEqual(outcome.shared, outcome.legacy);
    assert.deepEqual(outcome.shared.decisions, [10]);
  });

  test("/v1/deni/usage reports the same plan and pool", async () => {
    const reports = {} as Record<Mode, unknown>;
    for (const mode of MODES) {
      await resetFlixaUsageTables(pglite);
      await seedUser(pglite, USER);
      await seedBilling(pglite, {
        id: "plus",
        userId: USER,
        planId: "plus_monthly",
        paymentMethodFingerprint: "fp",
      });
      await seedRunSpend(pglite, USER, 250_000);
      const chat = await web.consumeUsage({
        userId: USER,
        category: "basic",
        reservationId: "chat",
        amount: 4_000,
      });
      await web.settleUsage({ userId: USER, reservationId: chat.reservationId, amount: 4_000 });
      await reserveAndSettle(mode, 9_000, 7_000);
      const info = mode === "shared" ? await getSharedDeniUsageInfo(USER) : await getDeniUsageInfo(USER);
      reports[mode] = {
        tier: info.tier,
        planId: info.planId,
        status: info.status,
        isTeam: info.isTeam,
        hasVerifiedPaymentMethod: info.hasVerifiedPaymentMethod,
        periodEnd: info.periodEnd,
        pool: info.pool,
        usage: info.usage.map(({ category, limit, used, remaining, periodEnd }) => ({
          category,
          limit,
          used,
          remaining,
          periodEnd,
        })),
      };
    }
    assert.deepEqual(reports.shared, reports.legacy);
  });
});

describe("intended differences", () => {
  test("Max Mode: shared spends credits past the pool, legacy refuses", async () => {
    const outcome = await both(
      async () => {
        await seedBilling(pglite, {
          id: "pro",
          userId: USER,
          planId: "pro_monthly",
          maxModeEnabled: true,
        });
        await seedCreditLot(pglite, { userId: USER, units: 1_000_000 });
      },
      async (mode) => [
        decision(await reserveAndSettle(mode, PRO_POOL, PRO_POOL)),
        (await reserve(mode, 100)).allowed,
      ],
    );
    assert.equal(outcome.legacy.decisions[1], false);
    assert.equal(outcome.shared.decisions[1], true);
  });

  test("a tier change: legacy resets the period's usage, shared keeps it", async () => {
    const outcome = await both(
      async () => {},
      async (mode) => {
        await reserveAndSettle(mode, 1_000, 1_000);
        await seedBilling(pglite, { id: "plus", userId: USER, planId: "plus_monthly" });
        await reserveAndSettle(mode, 50, 50);
        return [];
      },
    );
    assert.equal(outcome.legacy.quota[0]?.used, 50);
    assert.equal(outcome.shared.quota[0]?.used, 1_050);
  });

  test("an incomplete subscription: legacy grants the plan's pool, shared the Free pool", async () => {
    const limits = {} as Record<Mode, number>;
    for (const mode of MODES) {
      await resetFlixaUsageTables(pglite);
      await seedUser(pglite, USER);
      await seedBilling(pglite, {
        id: "plus",
        userId: USER,
        planId: "plus_monthly",
        status: "incomplete",
      });
      const info = mode === "shared" ? await getSharedDeniUsageInfo(USER) : await getDeniUsageInfo(USER);
      limits[mode] = info.pool.limit;
    }
    assert.equal(limits.legacy, getUsagePoolUnits("plus"));
    assert.equal(limits.shared, FREE_POOL);
  });

  test("a pending account deletion: shared refuses, legacy reserves", async () => {
    const outcome = await both(
      async () => {
        await seedBilling(pglite, {
          id: "go",
          userId: USER,
          planId: "go_monthly",
          deletionPending: true,
        });
      },
      async (mode) => [(await reserve(mode, 10)).allowed],
    );
    assert.deepEqual(outcome.legacy.decisions, [true]);
    assert.deepEqual(outcome.shared.decisions, [false]);
  });

  test("a crashed request: legacy keeps the estimate, shared recovers the observed amount", async () => {
    const outcome = await both(
      async () => {},
      async (mode) => {
        await reserve(mode, 5_000);
        await runFlixaUsageRecovery(new Date(Date.now() + USAGE_RESERVATION_STALE_MS + 60_000));
        return [await countLegacyReceipts(pglite), (await readReservations(pglite, USER)).length];
      },
    );
    // Legacy: an orphaned receipt and the whole estimate stay charged.
    assert.equal(outcome.legacy.quota[0]?.used, 5_000);
    assert.deepEqual(outcome.legacy.decisions, [1, 0]);
    // Shared: no heartbeat was recorded, so the abandoned estimate is not billed.
    assert.equal(outcome.shared.quota[0]?.used, 0);
    assert.deepEqual(outcome.shared.decisions, [0, 1]);
  });
});
