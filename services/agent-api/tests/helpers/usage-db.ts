import { mock } from "node:test";
import { createUsageTestDb } from "@deniai/billing/testing";
import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import type { DeniDb } from "../../utils/deni/db";
import { migrateFlixa } from "./flixa-db";

/**
 * PostgreSQL/WASM with the real `public` and `flixa` migrations, installed as the
 * agent API's database: `getDeniPool()` (raw SQL) and `getDeniDb()` (Drizzle) both
 * use it. Call before importing anything that reads the database.
 */
export async function installUsageTestDb(): Promise<{ pglite: PGlite; db: DeniDb }> {
  const { pglite, db } = await createUsageTestDb();
  await migrateFlixa(pglite);
  const database = await import("../../utils/deni/db");
  const pool = {
    query: (text: string, values?: unknown[]) => pglite.query(text, values),
  } as unknown as Pool;
  const deniDb = db as unknown as DeniDb;
  mock.module("../../utils/deni/db", {
    exports: { ...database, getDeniPool: () => pool, getDeniDb: () => deniDb },
  });
  return { pglite, db: deniDb };
}

/** Empty the Flixa receipts, usage and billing tables between tests. */
export async function resetFlixaUsageTables(pglite: PGlite): Promise<void> {
  const { resetUsageTables } = await import("@deniai/billing/testing");
  await resetUsageTables(pglite);
  await pglite.exec("TRUNCATE flixa.usage_reservation");
}

export async function countLegacyReceipts(pglite: PGlite): Promise<number> {
  const result = await pglite.query<{ n: number | string }>(
    "SELECT count(*) AS n FROM flixa.usage_reservation",
  );
  return Number(result.rows[0]?.n ?? 0);
}

/** Wait for a condition the route reaches after the response (stream cancel / settle). */
export async function eventually(check: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Condition not reached in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
