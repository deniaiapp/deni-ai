import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import type { Pool } from "pg";
import { Hono } from "hono";

// Swap getDeniPool / getDeniDb for mocks before any module that imports them is loaded.
const database = await import("../utils/deni/db");
const getDeniPool = mock.fn(database.getDeniPool);
const getDeniDb = mock.fn(database.getDeniDb);
mock.module("../utils/deni/db", { exports: { ...database, getDeniPool, getDeniDb } });
const { hashApiKey } = await import("../utils/deni/auth");
const { BANNED_ERROR_MESSAGE, invalidateBanCache } = await import("../utils/deni/ban");
const { invalidateSilentBanRulesCache } = await import("../utils/deni/silentBanRules");
const { validateAgentApiKey, validateAgentAuth } = await import(
  "../middleware/validateAgentAuth"
);
const { createFlixaTestDb } = await import("./helpers/flixa-db");

// Flixa's tables run in isolated PostgreSQL/WASM; API key lookups use an
// in-memory pool. No external DB or keys.
const { pglite, db } = await createFlixaTestDb();
const keyOwners = new Map<string, string>();
let keyCounter = 0;
const oldAuthDisabled = process.env.FLIXA_AUTH_DISABLED;

async function fakeQuery(sql: string, values?: unknown[]) {
  if (sql.includes("FROM api_key k")) {
    const userId = keyOwners.get(String(values?.[0]));
    return {
      rows: userId ? [{ user_id: userId, expires_at: null, is_anonymous: false }] : [],
      rowCount: userId ? 1 : 0,
    };
  }
  // last_used_at touch, etc.
  return { rows: [], rowCount: 0 };
}

async function newKey(): Promise<{ key: string; userId: string }> {
  keyCounter += 1;
  const key = `deni_bancheck_${keyCounter}_${"x".repeat(24)}`;
  const userId = `ban-check-user-${keyCounter}`;
  keyOwners.set(hashApiKey(key), userId);
  await pglite.query(`INSERT INTO "user" (id) VALUES ($1)`, [userId]);
  return { key, userId };
}

async function ban(userId: string): Promise<void> {
  await pglite.query(`INSERT INTO flixa.ban (user_id, reason) VALUES ($1, 'manual')`, [userId]);
}

async function addMatchingRule(): Promise<void> {
  await pglite.query(
    `INSERT INTO flixa.silent_ban_rule (id, name, hits_before_ban, reason, conditions)
     VALUES ('rule-1', 'codex', 3, 'silent_rule:codex', $1::jsonb)`,
    [JSON.stringify([{ target: "user-agent", op: "contains", value: "codex_cli_rs" }])],
  );
}

// Queries against a renamed table fail like an unreachable database would.
const brokenTables = new Set<string>();
async function breakTable(table: string): Promise<void> {
  await pglite.exec(`ALTER TABLE flixa.${table} RENAME TO ${table}_broken`);
  brokenTables.add(table);
}

function request(app: Hono, path: string, key: string, method = "GET") {
  return app.request(path, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      originator: "codex_cli_rs",
      "user-agent": "codex_cli_rs/0.144.0",
    },
  });
}

let served = 0;
function modelsApp(): Hono {
  const hono = new Hono();
  hono.get("/v1/models", validateAgentApiKey, (c) => {
    served += 1;
    return c.json({ ok: true });
  });
  return hono;
}

function inferenceApp(): Hono {
  const hono = new Hono();
  hono.post("/v1/agent/chat/completions", validateAgentAuth, (c) => {
    served += 1;
    return c.json({ ok: true });
  });
  return hono;
}

before(() => {
  const pool = { query: fakeQuery } as unknown as Pool;
  getDeniPool.mock.mockImplementation(() => pool);
  getDeniDb.mock.mockImplementation(() => db);
});

beforeEach(async () => {
  delete process.env.FLIXA_AUTH_DISABLED;
  for (const table of brokenTables) {
    await pglite.exec(`ALTER TABLE flixa.${table}_broken RENAME TO ${table}`);
  }
  brokenTables.clear();
  await pglite.exec("TRUNCATE flixa.ban, flixa.silent_ban_rule, flixa.silent_ban_hit");
  served = 0;
  invalidateBanCache();
  invalidateSilentBanRulesCache();
});

after(async () => {
  getDeniPool.mock.restore();
  getDeniDb.mock.restore();
  await pglite.close();
  if (oldAuthDisabled === undefined) delete process.env.FLIXA_AUTH_DISABLED;
  else process.env.FLIXA_AUTH_DISABLED = oldAuthDisabled;
});

const dbErrorBody = {
  error: {
    message: "Database error during validation",
    type: "server_error",
    param: null,
    code: "db_error",
  },
};

describe("flixa ban check", () => {
  test("fails closed with 503 when the ban lookup errors", async () => {
    await breakTable("ban");
    const { key } = await newKey();
    const res = await request(modelsApp(), "/v1/models", key);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), dbErrorBody);
    assert.equal(served, 0);
  });

  test("does not serve inference requests when the ban lookup errors", async () => {
    await breakTable("ban");
    const { key } = await newKey();
    const res = await request(inferenceApp(), "/v1/agent/chat/completions", key, "POST");
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), dbErrorBody);
    assert.equal(served, 0);
  });

  test("does not cache a failed lookup", async () => {
    const app = modelsApp();
    const { key } = await newKey();
    await breakTable("ban");
    assert.equal((await request(app, "/v1/models", key)).status, 503);

    await pglite.exec("ALTER TABLE flixa.ban_broken RENAME TO ban");
    brokenTables.delete("ban");
    const res = await request(app, "/v1/models", key);
    assert.equal(res.status, 200);
    assert.equal(served, 1);
  });

  test("serves users that are not banned", async () => {
    const { key } = await newKey();
    const res = await request(modelsApp(), "/v1/models", key);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(served, 1);
  });

  test("rejects banned users with the unchanged 403 response", async () => {
    const { key, userId } = await newKey();
    await ban(userId);
    const res = await request(modelsApp(), "/v1/models", key);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), {
      error: {
        message: BANNED_ERROR_MESSAGE,
        type: "authentication_error",
        param: null,
        code: "service_unavailable",
      },
    });
    assert.equal(served, 0);
  });

  test("fails closed when silent-ban rules cannot be loaded", async () => {
    await breakTable("silent_ban_rule");
    const { key } = await newKey();
    const res = await request(modelsApp(), "/v1/models", key);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), dbErrorBody);
    assert.equal(served, 0);
  });

  test("fails closed when a silent-ban hit cannot be counted", async () => {
    await addMatchingRule();
    await breakTable("silent_ban_hit");
    const { key } = await newKey();
    const res = await request(inferenceApp(), "/v1/agent/chat/completions", key, "POST");
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), dbErrorBody);
    assert.equal(served, 0);
  });

  test("still serves requests counted below the silent-ban threshold", async () => {
    await addMatchingRule();
    const { key, userId } = await newKey();
    const res = await request(modelsApp(), "/v1/models", key);
    assert.equal(res.status, 200);
    assert.equal(served, 1);
    const hits = await pglite.query<{ hit_count: number }>(
      "SELECT hit_count FROM flixa.silent_ban_hit WHERE user_id = $1",
      [userId],
    );
    assert.equal(hits.rows[0]?.hit_count, 1);
  });

  test("bans on the threshold hit and revokes the user's keys", async () => {
    await addMatchingRule();
    await pglite.exec("CREATE TABLE IF NOT EXISTS api_key (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)");
    const app = modelsApp();
    const { key, userId } = await newKey();
    await pglite.query("INSERT INTO api_key (id, user_id) VALUES ('key-1', $1)", [userId]);
    assert.equal((await request(app, "/v1/models", key)).status, 200);
    assert.equal((await request(app, "/v1/models", key)).status, 200);
    assert.equal((await request(app, "/v1/models", key)).status, 403);

    const banned = await pglite.query<{ reason: string }>(
      "SELECT reason FROM flixa.ban WHERE user_id = $1",
      [userId],
    );
    assert.equal(banned.rows[0]?.reason, "silent_rule:codex");
    const keys = await pglite.query("SELECT id FROM api_key WHERE user_id = $1", [userId]);
    assert.equal(keys.rows.length, 0);
  });

  test("deleting the Deni AI account deletes its ban and hits", async () => {
    await addMatchingRule();
    const { key, userId } = await newKey();
    await request(modelsApp(), "/v1/models", key);
    await ban(userId);
    await pglite.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
    const left = await pglite.query(
      `SELECT user_id FROM flixa.ban WHERE user_id = $1
       UNION ALL SELECT user_id FROM flixa.silent_ban_hit WHERE user_id = $1`,
      [userId],
    );
    assert.equal(left.rows.length, 0);
  });

  test("keeps serving a cached ban answer when a later lookup would error", async () => {
    const app = modelsApp();
    const { key, userId } = await newKey();
    await ban(userId);
    assert.equal((await request(app, "/v1/models", key)).status, 403);

    await breakTable("ban");
    assert.equal((await request(app, "/v1/models", key)).status, 403);
    assert.equal(served, 0);
  });
});
