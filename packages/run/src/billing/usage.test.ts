import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  configureRunForTest,
  createRunTestDb,
  resetRunTables,
  seedTestUser,
  type RunTestDb,
} from "../testing";
import { mutateStore, readStore } from "../data/store";
import {
  assertCanCreateTeammate,
  assertCanUseTokens,
  isBrowserLimitReached,
  recordModelSteps,
  recordTimeUsage,
  UsageLimitError,
} from "./usage";

let testDb: RunTestDb;
let engine: ReturnType<typeof configureRunForTest>["engine"];
const USER = "user-usage";

beforeAll(async () => {
  testDb = await createRunTestDb();
  ({ engine } = configureRunForTest(testDb));
}, 60_000);

afterAll(async () => {
  await testDb.pglite.close();
});

beforeEach(async () => {
  await resetRunTables(testDb.pglite);
  await seedTestUser(testDb.pglite, USER);
});

async function ledger() {
  const result = await testDb.pglite.query<{ metric: string; unit: string; used: string }>(
    `SELECT metric, unit, used::text FROM product_usage WHERE user_id = $1 AND product = 'run' ORDER BY metric`,
    [USER],
  );
  return result.rows.map((row) => ({ ...row, used: Number(row.used) }));
}

describe("run usage through the shared engine", () => {
  it("charges browser and computer time at the default hourly rates", async () => {
    await recordTimeUsage(USER, "browser", 3_600_000);
    await recordTimeUsage(USER, "computer", 1_800_000);
    expect(await ledger()).toEqual([
      { metric: "browser", unit: "usd_micros", used: 100_000 },
      { metric: "computer", unit: "usd_micros", used: 75_000 },
    ]);
    const budget = await engine.getRunBudget(USER);
    expect(budget.tier).toBe("free");
    expect(budget.limitUsd).toBe(10);
    expect(budget.poolUsd.run).toBeCloseTo(0.175, 6);
    expect(budget.remainingUsd).toBeCloseTo(9.825, 6);
  });

  it("charges model calls at the cost OpenRouter reports", async () => {
    await recordModelSteps(
      USER,
      [
        { providerMetadata: { openrouter: { usage: { cost: 0.25 } } } },
        { providerMetadata: { openrouter: { usage: { cost: 0.5 } } } },
      ],
      "anthropic/claude-sonnet-5.5",
    );
    expect(await ledger()).toEqual([{ metric: "model", unit: "usd_micros", used: 750_000 }]);
  });

  it("refuses work once the shared pool is spent, including chat and Flixa use", async () => {
    await expect(assertCanUseTokens(USER)).resolves.toBeUndefined();
    await recordModelSteps(
      USER,
      [{ providerMetadata: { openrouter: { usage: { cost: 9.99 } } } }],
      "anthropic/claude-sonnet-5.5",
    );
    await expect(assertCanUseTokens(USER)).resolves.toBeUndefined();
    // One more minute of browser time would cross the pool.
    expect(await isBrowserLimitReached(USER, 10 * 60 * 60_000)).toBe(true);
    await recordModelSteps(
      USER,
      [{ providerMetadata: { openrouter: { usage: { cost: 0.02 } } } }],
      "anthropic/claude-sonnet-5.5",
    );
    await expect(assertCanUseTokens(USER)).rejects.toBeInstanceOf(UsageLimitError);
  });

  it("limits teammates by plan (Free: 5)", async () => {
    await readStore(USER);
    await mutateStore(USER, (store) => {
      for (const id of ["a", "b"]) {
        store.bots.push({
          ...store.bots[0]!,
          id,
          name: id,
          memory: [],
        });
      }
    });
    await expect(assertCanCreateTeammate(USER)).rejects.toMatchObject({ metric: "teammates" });
  });

  it("serializes ledger writes with chat reservations under the user lock", async () => {
    const reservation = await engine.consumeUsage({
      userId: USER,
      category: "basic",
      reservationId: "chat-1",
      amount: 1_000,
    });
    expect(reservation).toBeTruthy();
    await Promise.all([
      recordTimeUsage(USER, "computer", 3_600_000),
      engine.settleUsage({ userId: USER, reservationId: "chat-1", amount: 500 }),
    ]);
    const budget = await engine.getRunBudget(USER);
    expect(budget.poolUsd.run).toBeCloseTo(0.15, 6);
    expect(budget.poolUsd.chat).toBeGreaterThan(0);
  });
});
