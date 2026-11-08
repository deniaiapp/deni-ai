import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createUsageTestDb,
  readCreditUnits,
  readProductUsage,
  readQuota,
  readReservations,
  resetUsageTables,
  seedBilling,
  seedCreditLot,
  seedMemberPolicy,
  seedRunSpend,
  seedTeam,
  seedUser,
  type UsageTestDb,
} from "../testing";
import { getUsagePoolUnits } from "./usage-engine";
import { createUsageEngine, UsageLimitError, USAGE_RESERVATION_STALE_MS } from ".";

// Real `public` migrations in PostgreSQL/WASM: the engine's SQL runs as in production.
let testDb: UsageTestDb;
const scheduleRecovery = vi.fn();
const autoTopUp = vi.fn(async () => false);
const logger = { error: vi.fn(), warn: vi.fn() };
let engine: ReturnType<typeof createUsageEngine>;

const FREE_POOL = getUsagePoolUnits("free");
const PRO_POOL = getUsagePoolUnits("pro");
let nextId = 0;
const id = () => `reservation-${++nextId}`;

beforeAll(async () => {
  testDb = await createUsageTestDb();
  engine = createUsageEngine({ db: testDb.db, scheduleRecovery, autoTopUp, logger });
}, 60_000);

afterAll(async () => {
  await testDb.pglite.close();
});

beforeEach(async () => {
  await resetUsageTables(testDb.pglite);
  scheduleRecovery.mockClear();
  autoTopUp.mockClear();
  await seedUser(testDb.pglite, "user");
});

/** Spend `amount` of the user's pool through a settled chat reservation. */
async function spend(userId: string, amount: number) {
  const reservationId = id();
  await engine.consumeUsage({ userId, category: "basic", reservationId, amount });
  await engine.settleUsage({ userId, reservationId, amount });
}

describe("reserve and settle", () => {
  test("a chat reservation holds the estimate and settles the actual amount once", async () => {
    const reservationId = id();
    const reserved = await engine.consumeUsage({
      userId: "user",
      category: "basic",
      reservationId,
      amount: 100,
    });
    expect(reserved).toMatchObject({ tier: "free", limit: FREE_POOL, usedMaxMode: false });
    expect(reserved.remaining).toBe(FREE_POOL - 100);
    expect(await readQuota(testDb.pglite, "user")).toEqual([
      { category: "basic", used: 100, unit: "units", planTier: "free" },
    ]);

    await engine.settleUsage({ userId: "user", reservationId, amount: 30 });
    await engine.settleUsage({ userId: "user", reservationId, amount: 999 });
    expect((await readQuota(testDb.pglite, "user"))[0].used).toBe(30);
    expect(await readReservations(testDb.pglite, "user")).toMatchObject([
      { id: reservationId, product: "chat", reservedAmount: 100, settledAmount: 30, settled: true },
    ]);
    expect(await readProductUsage(testDb.pglite, "user")).toEqual([
      { product: "chat", metric: "basic", unit: "units", used: 30 },
    ]);
  });

  test("a Flixa reservation records its settlement in the Flixa ledger and the summary", async () => {
    await spend("user", 300);
    const reservationId = id();
    await engine.consumeUsage({
      userId: "user",
      category: "basic",
      reservationId,
      amount: 500,
      product: "flixa",
    });
    await engine.settleUsage({ userId: "user", reservationId, amount: 100 });
    expect(await readProductUsage(testDb.pglite, "user")).toEqual([
      { product: "chat", metric: "basic", unit: "units", used: 300 },
      { product: "flixa", metric: "basic", unit: "units", used: 100 },
    ]);
    const summary = await engine.getUsageSummary({ userId: "user" });
    expect(summary.pool).toMatchObject({
      limit: FREE_POOL,
      used: { chat: 300, flixa: 100, run: 0 },
    });
    expect(summary.usage[0]).toMatchObject({ used: 400, remaining: FREE_POOL - 400 });
  });

  test("a zero settlement releases the hold and writes no ledger row", async () => {
    const reservationId = id();
    await engine.consumeUsage({ userId: "user", category: "basic", reservationId, amount: 50 });
    await engine.settleUsage({ userId: "user", reservationId, amount: 0 });
    expect((await readQuota(testDb.pglite, "user"))[0].used).toBe(0);
    expect(await readProductUsage(testDb.pglite, "user")).toEqual([]);
  });

  test("a request past the pool is refused without writing", async () => {
    await spend("user", FREE_POOL - 10);
    await expect(
      engine.consumeUsage({ userId: "user", category: "basic", reservationId: id(), amount: 11 }),
    ).rejects.toBeInstanceOf(UsageLimitError);
    expect((await readQuota(testDb.pglite, "user"))[0].used).toBe(FREE_POOL - 10);
    expect(await readReservations(testDb.pglite, "user")).toHaveLength(1);
    await expect(
      engine.consumeUsage({ userId: "user", category: "basic", reservationId: id(), amount: 10 }),
    ).resolves.toMatchObject({ remaining: 0 });
  });

  test("Deni Run and legacy premium rows spend the same pool", async () => {
    // $2.50 of Deni Run = 5M units.
    await seedRunSpend(testDb.pglite, "user", 2_500_000);
    await engine.consumeUsage({
      userId: "user",
      category: "premium",
      reservationId: id(),
      amount: 10_000_000,
    });
    const left = FREE_POOL - 5_000_000 - 10_000_000;
    await expect(
      engine.consumeUsage({
        userId: "user",
        category: "basic",
        reservationId: id(),
        amount: left + 1,
      }),
    ).rejects.toThrow("Usage limit reached");
    await expect(
      engine.consumeUsage({ userId: "user", category: "basic", reservationId: id(), amount: left }),
    ).resolves.toMatchObject({ remaining: 0 });
  });

  test("an account being deleted cannot reserve", async () => {
    await seedBilling(testDb.pglite, {
      id: "personal",
      userId: "user",
      planId: "pro_monthly",
      deletionPending: true,
    });
    await expect(
      engine.consumeUsage({ userId: "user", category: "basic", reservationId: id(), amount: 1 }),
    ).rejects.toThrow("Account deletion is in progress.");
  });
});

describe("Max Mode credits", () => {
  beforeEach(async () => {
    await seedBilling(testDb.pglite, {
      id: "personal",
      userId: "user",
      planId: "pro_monthly",
      maxModeEnabled: true,
    });
  });

  test("usage past the pool spends the owner's credits and checks the auto top-up", async () => {
    await seedCreditLot(testDb.pglite, { userId: "user", units: 1_000 });
    await spend("user", PRO_POOL - 10);
    const reservationId = id();
    await expect(
      engine.consumeUsage({ userId: "user", category: "basic", reservationId, amount: 20 }),
    ).resolves.toMatchObject({ usedMaxMode: true, allowance: 1_010 });
    const settled = await engine.settleUsage({ userId: "user", reservationId, amount: 20 });
    expect(settled).toEqual({ amount: 20, maxModeAmount: 10 });
    expect(await readCreditUnits(testDb.pglite, { userId: "user" })).toBe(990);
    expect((await readQuota(testDb.pglite, "user"))[0].used).toBe(PRO_POOL + 10);
    expect(autoTopUp).toHaveBeenCalledWith(
      { userId: "user", organizationId: null },
      expect.any(Date),
    );
  });

  test("without credits Max Mode carries nothing past the pool", async () => {
    await spend("user", PRO_POOL - 10);
    await expect(
      engine.consumeUsage({ userId: "user", category: "basic", reservationId: id(), amount: 20 }),
    ).rejects.toMatchObject({ name: "UsageLimitError", maxModeAvailable: true });
  });
});

describe("team usage policy", () => {
  beforeEach(async () => {
    await seedUser(testDb.pglite, "owner");
    await seedTeam(testDb.pglite, "team", ["owner", "user"]);
    await seedBilling(testDb.pglite, {
      id: "team-billing",
      userId: "owner",
      organizationId: "team",
      planId: "pro_team_monthly",
      maxModeEnabled: true,
    });
    await seedCreditLot(testDb.pglite, { organizationId: "team", units: 1_000_000 });
  });

  test("a member's Max Mode cap bounds their overage and the team pays", async () => {
    await seedMemberPolicy(testDb.pglite, {
      organizationId: "team",
      userId: "user",
      maxModeLimit: 15,
    });
    await spend("user", PRO_POOL);
    await expect(
      engine.consumeUsage({ userId: "user", category: "basic", reservationId: id(), amount: 20 }),
    ).rejects.toThrow("Usage limit reached");
    const reservationId = id();
    await engine.consumeUsage({ userId: "user", category: "basic", reservationId, amount: 10 });
    // Settling more than the cap records all usage but spends only up to the cap.
    await expect(
      engine.settleUsage({ userId: "user", reservationId, amount: 40 }),
    ).resolves.toEqual({ amount: 40, maxModeAmount: 15 });
    expect(await readCreditUnits(testDb.pglite, { organizationId: "team" })).toBe(1_000_000 - 15);
  });

  test("a member with Max Mode turned off stops at the pool", async () => {
    await seedMemberPolicy(testDb.pglite, {
      organizationId: "team",
      userId: "user",
      maxModeEnabled: false,
    });
    await spend("user", PRO_POOL);
    await expect(
      engine.consumeUsage({ userId: "user", category: "basic", reservationId: id(), amount: 1 }),
    ).rejects.toMatchObject({ maxModeAvailable: false });
  });
});

describe("recovery", () => {
  test("a stale reservation settles at its observed amount, never at the estimate", async () => {
    const start = new Date();
    const reservationId = id();
    await engine.consumeUsage({
      userId: "user",
      category: "basic",
      reservationId,
      amount: 100,
      product: "flixa",
      now: start,
    });
    await engine.recordObservedUsage({ userId: "user", reservationId, amount: 30, now: start });
    // Not stale yet.
    expect(await engine.recoverUsageReservations(new Date(start.getTime() + 60_000))).toEqual({
      recovered: 0,
      recoveryFailed: 0,
    });
    const later = new Date(start.getTime() + USAGE_RESERVATION_STALE_MS + 60_000);
    expect(await engine.recoverUsageReservations(later)).toEqual({
      recovered: 1,
      recoveryFailed: 0,
    });
    expect((await readQuota(testDb.pglite, "user"))[0].used).toBe(30);
    expect(await readProductUsage(testDb.pglite, "user")).toEqual([
      { product: "flixa", metric: "basic", unit: "units", used: 30 },
    ]);
    // The real settlement arriving late changes nothing.
    await engine.settleUsage({ userId: "user", reservationId, amount: 90 });
    expect((await readQuota(testDb.pglite, "user"))[0].used).toBe(30);
  });

  test("a failed settlement asks the host to run recovery once the reservation is stale", async () => {
    const before = Date.now();
    await expect(
      engine.settleUsage({ userId: "user", reservationId: "missing", amount: 1 }),
    ).rejects.toThrow("Usage reservation not found.");
    expect(scheduleRecovery).toHaveBeenCalledOnce();
    expect(scheduleRecovery.mock.calls[0][0]).toBeGreaterThanOrEqual(
      before + USAGE_RESERVATION_STALE_MS,
    );
  });
});

describe("dry run", () => {
  test("returns the reservation it would make and writes nothing", async () => {
    await spend("user", 1_000);
    const before = {
      quota: await readQuota(testDb.pglite, "user"),
      reservations: await readReservations(testDb.pglite, "user"),
    };
    await expect(
      engine.consumeUsage({
        userId: "user",
        category: "basic",
        reservationId: id(),
        amount: 500,
        product: "flixa",
        dryRun: true,
      }),
    ).resolves.toMatchObject({ remaining: FREE_POOL - 1_500, usedMaxMode: false });
    await expect(
      engine.consumeUsage({
        userId: "user",
        category: "basic",
        reservationId: id(),
        amount: FREE_POOL,
        dryRun: true,
      }),
    ).rejects.toBeInstanceOf(UsageLimitError);
    expect(await readQuota(testDb.pglite, "user")).toEqual(before.quota);
    expect(await readReservations(testDb.pglite, "user")).toEqual(before.reservations);
  });
});
