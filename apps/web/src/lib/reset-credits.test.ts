import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";
import { consumeResetCredit, resetCreditExpiry } from "./reset-credits";

type Credit = { id: string; expiresAt: Date; usedAt: Date | null };

const DAY = 24 * 60 * 60 * 1000;
const dialect = new PgDialect();
/** The bound values of a drizzle condition, to see which credit id a query targets. */
const paramsOf = (condition: SQL | undefined) =>
  condition ? dialect.sqlToQuery(condition).params : [];

const state = vi.hoisted(() => ({
  legacy: 0,
  credits: [] as { id: string; expiresAt: Date; usedAt: Date | null }[],
  used: 100,
  failQuota: false,
  locked: false,
  nextId: 1,
}));

function usable(now = Date.now()) {
  return state.credits
    .filter((credit) => !credit.usedAt && credit.expiresAt.getTime() > now)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
}

vi.mock("@/db/drizzle", () => ({
  db: {
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone({
        legacy: state.legacy,
        credits: state.credits,
        used: state.used,
      });
      const tx = {
        execute: async () => {
          state.locked = true;
        },
        select: (fields: Record<string, unknown>) => ({
          from: (table: Parameters<typeof getTableName>[0]) => ({
            where: (condition: SQL | undefined) => {
              expect(state.locked).toBe(true);
              const name = getTableName(table);
              if (name === "reset_credit_balance") {
                return { for: async () => (state.legacy > 0 ? [{ credits: state.legacy }] : []) };
              }
              if ("count" in fields) {
                return Promise.resolve([{ count: usable().length }]);
              }
              const [creditId] = paramsOf(condition).filter(
                (param) => typeof param === "string" && param.startsWith("credit-"),
              );
              return {
                orderBy: () => ({
                  limit: async () =>
                    usable()
                      .filter((credit) => !creditId || credit.id === creditId)
                      .slice(0, 1)
                      .map(({ id }) => ({ id })),
                }),
              };
            },
          }),
        }),
        update: (table: Parameters<typeof getTableName>[0]) => ({
          set: (values: { usedAt?: Date }) => ({
            where: async (condition: SQL | undefined) => {
              expect(state.locked).toBe(true);
              const name = getTableName(table);
              if (name === "usage_quota") {
                if (state.failQuota) throw new Error("Quota write failed");
                state.used = 0;
              } else if (name === "reset_credit_balance") {
                state.legacy = 0;
              } else {
                const [id] = paramsOf(condition);
                const credit = state.credits.find((row) => row.id === id);
                if (credit) credit.usedAt = values.usedAt ?? null;
              }
            },
          }),
        }),
        insert: () => ({
          values: async (rows: { expiresAt: Date }[]) => {
            for (const row of rows) {
              state.credits.push({
                id: `credit-${state.nextId++}`,
                expiresAt: row.expiresAt,
                usedAt: null,
              });
            }
          },
        }),
      };
      try {
        return await run(tx);
      } catch (error) {
        Object.assign(state, snapshot);
        throw error;
      } finally {
        state.locked = false;
      }
    },
  },
}));

function addCredit(expiresInDays: number, usedAt: Date | null = null): Credit {
  const credit = {
    id: `credit-${state.nextId++}`,
    expiresAt: new Date(Date.now() + expiresInDays * DAY),
    usedAt,
  };
  state.credits.push(credit);
  return credit;
}

beforeEach(() => {
  state.legacy = 0;
  state.credits = [];
  state.used = 100;
  state.failQuota = false;
  state.locked = false;
  state.nextId = 1;
});

test("a credit lasts one calendar month, clamped to the end of a shorter month", () => {
  expect(resetCreditExpiry(new Date("2026-11-09T12:00:00Z")).toISOString()).toBe(
    "2026-12-09T12:00:00.000Z",
  );
  expect(resetCreditExpiry(new Date("2027-01-31T00:00:00Z")).toISOString()).toBe(
    "2027-02-28T00:00:00.000Z",
  );
  expect(resetCreditExpiry(new Date("2028-01-31T00:00:00Z")).toISOString()).toBe(
    "2028-02-29T00:00:00.000Z",
  );
});

test("a reset spends the credit that expires first and clears the user's usage", async () => {
  const later = addCredit(20);
  const sooner = addCredit(3);
  expect(await consumeResetCredit("user")).toBe(1);
  expect(sooner.usedAt).not.toBeNull();
  expect(later.usedAt).toBeNull();
  expect(state.used).toBe(0);
});

test("a reset can spend a chosen credit", async () => {
  addCredit(3);
  const chosen = addCredit(20);
  expect(await consumeResetCredit("user", chosen.id)).toBe(1);
  expect(chosen.usedAt).not.toBeNull();
});

test("a failed reset returns the credit and keeps the original quota", async () => {
  addCredit(3);
  state.failQuota = true;
  await expect(consumeResetCredit("user")).rejects.toThrow("Quota write failed");
  expect(usable()).toHaveLength(1);
  expect(state.used).toBe(100);
});

test("expired or spent credits cannot be used", async () => {
  addCredit(-1);
  addCredit(10, new Date());
  expect(await consumeResetCredit("user")).toBeNull();
  expect(state.used).toBe(100);
});

test("a v7 credit count becomes credits valid for a month, and cannot be spent twice", async () => {
  state.legacy = 3;
  expect(await consumeResetCredit("user")).toBe(2);
  expect(state.legacy).toBe(0);
  expect(state.credits).toHaveLength(3);
  const expected = resetCreditExpiry(new Date()).getTime();
  for (const credit of state.credits) {
    expect(Math.abs(credit.expiresAt.getTime() - expected)).toBeLessThan(60_000);
  }
});
