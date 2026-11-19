import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

import {
  createUsageTestDb,
  readQuota,
  resetUsageTables,
  seedRunSpend,
  seedUser,
  type UsageTestDb,
} from "../testing";
import { createUsageEngine, hasResettableUsage, resetUserUsage } from ".";

// Real `public` migrations in PostgreSQL/WASM, as in usage-engine.test.ts.
let testDb: UsageTestDb;
let engine: ReturnType<typeof createUsageEngine>;

beforeAll(async () => {
  testDb = await createUsageTestDb();
  engine = createUsageEngine({
    db: testDb.db,
    scheduleRecovery: vi.fn(),
    autoTopUp: vi.fn(async () => false),
    logger: { error: vi.fn(), warn: vi.fn() },
  });
}, 60_000);

afterAll(async () => {
  await testDb.pglite.close();
});

beforeEach(async () => {
  await resetUsageTables(testDb.pglite);
  await seedUser(testDb.pglite, "user");
});

/** The user's usage period right now, as the web app passes it in. */
const period = () => engine.getUsagePeriod("user");

async function spendChat(amount: number) {
  const reservationId = `reservation-${amount}-${Date.now()}`;
  await engine.consumeUsage({ userId: "user", category: "basic", reservationId, amount });
  await engine.settleUsage({ userId: "user", reservationId, amount });
}

test("no usage means nothing to reset", async () => {
  expect(await hasResettableUsage("user", new Date(), await period(), testDb.db)).toBe(false);
});

test("Deni Run spend alone is resettable, and a reset clears it from the pool", async () => {
  await seedRunSpend(testDb.pglite, "user", 2_500_000);
  expect(await hasResettableUsage("user", new Date(), await period(), testDb.db)).toBe(true);
  expect((await engine.getRunBudget("user")).poolUsd.run).toBeGreaterThan(0);

  await resetUserUsage("user", new Date(), await period(), testDb.db);

  const budget = await engine.getRunBudget("user");
  expect(budget.poolUsd.run).toBe(0);
  expect(budget.usedUsd).toBe(0);
  expect(await hasResettableUsage("user", new Date(), await period(), testDb.db)).toBe(false);
});

test("a reset clears chat usage and Deni Run spend together", async () => {
  await spendChat(40);
  await seedRunSpend(testDb.pglite, "user", 1_000_000);
  expect(await hasResettableUsage("user", new Date(), await period(), testDb.db)).toBe(true);

  await resetUserUsage("user", new Date(), await period(), testDb.db);

  expect((await readQuota(testDb.pglite, "user")).every((row) => row.used === 0)).toBe(true);
  const budget = await engine.getRunBudget("user");
  expect(budget.usedUsd).toBe(0);
  expect(budget.poolUsd).toEqual({ chat: 0, flixa: 0, run: 0 });
});
