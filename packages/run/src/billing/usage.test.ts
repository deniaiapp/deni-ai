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
  beginModelUsage,
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

  it("charges model calls like chat: weighted tokens times the model's usage tier", async () => {
    // 100K input + 20K output x5 = 200K weighted tokens; Sonnet 5.5 is Tier 2 (1.5x):
    // 300K units = $0.15 per step.
    const step = { usage: { inputTokens: 100_000, outputTokens: 20_000 } };
    await recordModelSteps(USER, [step, step], "claude-sonnet-5.5");
    // Settled on the shared quota row like a chat request, recorded for Run in usage units.
    expect(await ledger()).toEqual([{ metric: "basic", unit: "units", used: 600_000 }]);
    const budget = await engine.getRunBudget(USER);
    expect(budget.poolUsd.run).toBeCloseTo(0.3, 6);
    expect(budget.poolUsd.chat).toBe(0);
    expect(budget.remainingUsd).toBeCloseTo(9.7, 6);
  });

  it("reserves a turn's usage, settles what was spent and refuses a turn once the pool is spent", async () => {
    const usage = await beginModelUsage(USER, "claude-sonnet-5.5");
    // The reservation holds an estimate until the turn settles.
    expect((await engine.getRunBudget(USER)).usedUsd).toBeGreaterThan(0);
    expect(usage.isSpent()).toBe(false);
    // 13.4M input x 1.5 = 20.1M units: past the $10 pool (20M units).
    usage.add({ usage: { inputTokens: 13_400_000, outputTokens: 0 } });
    expect(usage.isSpent()).toBe(true);
    await usage.settle();
    await usage.settle();
    expect(await ledger()).toEqual([{ metric: "basic", unit: "units", used: 20_100_000 }]);
    // No Max Mode credits: the next turn is refused, with Run's own limit error.
    await expect(beginModelUsage(USER, "claude-sonnet-5.5")).rejects.toBeInstanceOf(
      UsageLimitError,
    );
    await expect(assertCanUseTokens(USER)).rejects.toBeInstanceOf(UsageLimitError);
  });

  it("charges an id with an OpenRouter author prefix as its catalog model", async () => {
    // Haiku 5.5 is Tier 1: 200K units = $0.10.
    await recordModelSteps(
      USER,
      [{ usage: { inputTokens: 100_000, outputTokens: 20_000 } }],
      "anthropic/claude-haiku-5.5",
    );
    expect(await ledger()).toEqual([{ metric: "basic", unit: "units", used: 200_000 }]);
  });

  it("refuses work once the shared pool is spent, including chat and Flixa use", async () => {
    await expect(assertCanUseTokens(USER)).resolves.toBeUndefined();
    await recordModelSteps(
      USER,
      // 13.32M input x 1.5 = 19.98M units = $9.99 of the $10 pool.
      [{ usage: { inputTokens: 13_320_000, outputTokens: 0 } }],
      "claude-sonnet-5.5",
    );
    await expect(assertCanUseTokens(USER)).resolves.toBeUndefined();
    // One more minute of browser time would cross the pool.
    expect(await isBrowserLimitReached(USER, 10 * 60 * 60_000)).toBe(true);
    await recordModelSteps(
      USER,
      [{ usage: { inputTokens: 26_667, outputTokens: 0 } }],
      "claude-sonnet-5.5",
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
