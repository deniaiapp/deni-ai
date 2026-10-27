import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import type { Pool } from "pg";
import { Hono } from "hono";

// Swap getDeniPool for a mock before any module that imports it is loaded.
const database = await import("../utils/deni/db");
const getDeniPool = mock.fn(database.getDeniPool);
mock.module("../utils/deni/db", { exports: { ...database, getDeniPool } });
const { hashApiKey } = await import("../utils/deni/auth");
const { BANNED_ERROR_MESSAGE, invalidateBanCache } = await import("../utils/deni/ban");
const { invalidateSilentBanRulesCache } = await import("../utils/deni/silentBanRules");
const { validateAgentApiKey, validateAgentAuth } = await import(
  "../middleware/validateAgentAuth"
);

// In-memory stand-in for the Deni pool. No external DB or keys.
type BanLookupMode = "not_banned" | "banned" | "throw";
let banLookupMode: BanLookupMode = "not_banned";
let banTableSetupThrows = false;
// Silent-ban rules: "none" configured, one matching rule, or DB errors.
type SilentRulesMode = "none" | "matching_rule" | "rules_throw" | "hit_throw";
let silentRulesMode: SilentRulesMode = "none";
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
  if (sql.includes("flixa_ban") && /CREATE (TABLE|INDEX)/.test(sql)) {
    if (banTableSetupThrows) throw new Error("connection timeout");
    return { rows: [], rowCount: 0 };
  }
  if (sql.includes("SELECT user_id FROM flixa_ban")) {
    if (banLookupMode === "throw") throw new Error("connection timeout");
    const userId = String(values?.[0]);
    return banLookupMode === "banned"
      ? { rows: [{ user_id: userId }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }
  if (sql.includes("FROM flixa_silent_ban_rule")) {
    if (silentRulesMode === "rules_throw") throw new Error("connection timeout");
    if (silentRulesMode === "none") return { rows: [], rowCount: 0 };
    const row = {
      id: "rule-1",
      name: "codex",
      enabled: true,
      hits_before_ban: 3,
      reason: "silent_rule:codex",
      conditions: [{ target: "user-agent", op: "contains", value: "codex_cli_rs" }],
      created_at: new Date(0),
      updated_at: new Date(0),
    };
    return { rows: [row], rowCount: 1 };
  }
  if (sql.includes("INSERT INTO flixa_silent_ban_hit")) {
    if (silentRulesMode === "hit_throw") throw new Error("connection timeout");
    return { rows: [{ hit_count: 1 }], rowCount: 1 };
  }
  // last_used_at touch, silent-ban table setup, etc.
  return { rows: [], rowCount: 0 };
}

function newKey(): string {
  keyCounter += 1;
  const key = `deni_bancheck_${keyCounter}_${"x".repeat(24)}`;
  keyOwners.set(hashApiKey(key), `ban-check-user-${keyCounter}`);
  return key;
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
});

beforeEach(() => {
  delete process.env.FLIXA_AUTH_DISABLED;
  banLookupMode = "not_banned";
  banTableSetupThrows = false;
  silentRulesMode = "none";
  served = 0;
  invalidateBanCache();
  invalidateSilentBanRulesCache();
});

after(() => {
  getDeniPool.mock.restore();
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
    banLookupMode = "throw";
    const res = await request(modelsApp(), "/v1/models", newKey());
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), dbErrorBody);
    assert.equal(served, 0);
  });

  test("fails closed when ban table setup and lookup both error", async () => {
    banTableSetupThrows = true;
    banLookupMode = "throw";
    const res = await request(modelsApp(), "/v1/models", newKey());
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), dbErrorBody);
    assert.equal(served, 0);
  });

  test("does not serve inference requests when the ban lookup errors", async () => {
    banLookupMode = "throw";
    const res = await request(
      inferenceApp(),
      "/v1/agent/chat/completions",
      newKey(),
      "POST",
    );
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), dbErrorBody);
    assert.equal(served, 0);
  });

  test("does not cache a failed lookup", async () => {
    const app = modelsApp();
    const key = newKey();
    banLookupMode = "throw";
    assert.equal((await request(app, "/v1/models", key)).status, 503);

    banLookupMode = "not_banned";
    const res = await request(app, "/v1/models", key);
    assert.equal(res.status, 200);
    assert.equal(served, 1);
  });

  test("serves users that are not banned", async () => {
    const res = await request(modelsApp(), "/v1/models", newKey());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(served, 1);
  });

  test("rejects banned users with the unchanged 403 response", async () => {
    banLookupMode = "banned";
    const res = await request(modelsApp(), "/v1/models", newKey());
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
    silentRulesMode = "rules_throw";
    const res = await request(modelsApp(), "/v1/models", newKey());
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), dbErrorBody);
    assert.equal(served, 0);
  });

  test("fails closed when a silent-ban hit cannot be counted", async () => {
    silentRulesMode = "hit_throw";
    const res = await request(
      inferenceApp(),
      "/v1/agent/chat/completions",
      newKey(),
      "POST",
    );
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), dbErrorBody);
    assert.equal(served, 0);
  });

  test("still serves requests counted below the silent-ban threshold", async () => {
    silentRulesMode = "matching_rule";
    const res = await request(modelsApp(), "/v1/models", newKey());
    assert.equal(res.status, 200);
    assert.equal(served, 1);
  });

  test("keeps serving a cached ban answer when a later lookup would error", async () => {
    const app = modelsApp();
    const key = newKey();
    banLookupMode = "banned";
    assert.equal((await request(app, "/v1/models", key)).status, 403);

    banLookupMode = "throw";
    assert.equal((await request(app, "/v1/models", key)).status, 403);
    assert.equal(served, 0);
  });
});
