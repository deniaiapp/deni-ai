import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { Pool } from "pg";

// Swap getDeniPool for a mock before any module that imports it is loaded.
const database = await import("../utils/deni/db");
const getDeniPool = mock.fn(database.getDeniPool);
mock.module("../utils/deni/db", { exports: { ...database, getDeniPool } });
const { invalidateUserAuthCache, validateDeniApiKey } = await import("../utils/deni/auth");

// In-memory stand-in for the Deni pool. Counts api_key lookups.
type LookupMode = "not_found" | "throw" | "hang";
let lookupMode: LookupMode = "not_found";
let lookups = 0;
const hangingLookups: Array<() => void> = [];
let keyCounter = 0;

async function fakeQuery(sql: string) {
  if (sql.includes("FROM api_key k")) {
    lookups += 1;
    if (lookupMode === "throw") throw new Error("connection timeout");
    if (lookupMode === "hang") {
      await new Promise<void>((resolve) => hangingLookups.push(resolve));
    }
    return { rows: [], rowCount: 0 };
  }
  return { rows: [], rowCount: 0 };
}

function newKey(): string {
  keyCounter += 1;
  return `deni_negative_${keyCounter}_${"x".repeat(24)}`;
}

before(() => {
  const pool = { query: fakeQuery } as unknown as Pool;
  getDeniPool.mock.mockImplementation(() => pool);
});

beforeEach(() => {
  lookupMode = "not_found";
  lookups = 0;
  invalidateUserAuthCache();
});

after(() => {
  getDeniPool.mock.restore();
});

describe("validateDeniApiKey negative cache", () => {
  test("queries an unknown key once, then answers from cache", async () => {
    const key = newKey();
    const first = await validateDeniApiKey(key);
    const second = await validateDeniApiKey(key);

    assert.deepEqual(first, { valid: false, error: "API key not found", code: "invalid_key" });
    assert.deepEqual(second, first);
    assert.equal(lookups, 1);
  });

  test("clears cached invalid keys on a full auth cache invalidation", async () => {
    const key = newKey();
    await validateDeniApiKey(key);
    invalidateUserAuthCache();
    await validateDeniApiKey(key);

    assert.equal(lookups, 2);
  });

  test("does not cache DB errors", async () => {
    const key = newKey();
    lookupMode = "throw";
    assert.equal((await validateDeniApiKey(key)).valid, false);

    lookupMode = "not_found";
    const result = await validateDeniApiKey(key);
    assert.partialDeepStrictEqual(result, { valid: false, code: "invalid_key" });
    assert.equal(lookups, 2);
  });

  test("rejects over-long keys without a query", async () => {
    const result = await validateDeniApiKey(`deni_${"x".repeat(300)}`);

    assert.deepEqual(result, { valid: false, error: "Invalid API key format", code: "invalid_key" });
    assert.equal(lookups, 0);
  });

  test("caps concurrent lookups and rejects once the wait queue is full", async () => {
    lookupMode = "hang";
    // Defaults: 8 concurrent lookups plus 64 queued.
    const pending = Array.from({ length: 8 + 64 }, () => validateDeniApiKey(newKey()));
    await sleep(0);
    assert.equal(lookups, 8);

    const overflow = await validateDeniApiKey(newKey());
    assert.partialDeepStrictEqual(overflow, { valid: false, code: "db_error" });

    lookupMode = "not_found";
    while (hangingLookups.length > 0) hangingLookups.shift()!();
    const results = await Promise.all(pending);

    assert.equal(results.every((result) => !result.valid && result.code === "invalid_key"), true);
    assert.equal(lookups, 8 + 64);
  });
});
