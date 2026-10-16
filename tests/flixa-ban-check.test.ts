import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Pool } from "pg";
import { Hono } from "hono";
import * as database from "../utils/deni/db";
import { hashApiKey } from "../utils/deni/auth";
import { BANNED_ERROR_MESSAGE, invalidateBanCache } from "../utils/deni/ban";
import {
  validateAgentApiKey,
  validateAgentAuth,
} from "../middleware/validateAgentAuth";

// In-memory stand-in for the Deni pool. No external DB or keys.
type BanLookupMode = "not_banned" | "banned" | "throw";
let banLookupMode: BanLookupMode = "not_banned";
let banTableSetupThrows = false;
const keyOwners = new Map<string, string>();
let poolSpy: ReturnType<typeof spyOn>;
let keyCounter = 0;
const oldAuthDisabled = Bun.env.FLIXA_AUTH_DISABLED;

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
  // last_used_at touch, silent-ban tables and rules (none configured), etc.
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

beforeAll(() => {
  poolSpy = spyOn(database, "getDeniPool").mockReturnValue({
    query: fakeQuery,
  } as unknown as Pool);
});

beforeEach(() => {
  delete Bun.env.FLIXA_AUTH_DISABLED;
  banLookupMode = "not_banned";
  banTableSetupThrows = false;
  served = 0;
  invalidateBanCache();
});

afterAll(() => {
  poolSpy?.mockRestore();
  if (oldAuthDisabled === undefined) delete Bun.env.FLIXA_AUTH_DISABLED;
  else Bun.env.FLIXA_AUTH_DISABLED = oldAuthDisabled;
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
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(dbErrorBody);
    expect(served).toBe(0);
  });

  test("fails closed when ban table setup and lookup both error", async () => {
    banTableSetupThrows = true;
    banLookupMode = "throw";
    const res = await request(modelsApp(), "/v1/models", newKey());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(dbErrorBody);
    expect(served).toBe(0);
  });

  test("does not serve inference requests when the ban lookup errors", async () => {
    banLookupMode = "throw";
    const res = await request(
      inferenceApp(),
      "/v1/agent/chat/completions",
      newKey(),
      "POST",
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(dbErrorBody);
    expect(served).toBe(0);
  });

  test("does not cache a failed lookup", async () => {
    const app = modelsApp();
    const key = newKey();
    banLookupMode = "throw";
    expect((await request(app, "/v1/models", key)).status).toBe(503);

    banLookupMode = "not_banned";
    const res = await request(app, "/v1/models", key);
    expect(res.status).toBe(200);
    expect(served).toBe(1);
  });

  test("serves users that are not banned", async () => {
    const res = await request(modelsApp(), "/v1/models", newKey());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(served).toBe(1);
  });

  test("rejects banned users with the unchanged 403 response", async () => {
    banLookupMode = "banned";
    const res = await request(modelsApp(), "/v1/models", newKey());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        message: BANNED_ERROR_MESSAGE,
        type: "authentication_error",
        param: null,
        code: "service_unavailable",
      },
    });
    expect(served).toBe(0);
  });

  test("keeps serving a cached ban answer when a later lookup would error", async () => {
    const app = modelsApp();
    const key = newKey();
    banLookupMode = "banned";
    expect((await request(app, "/v1/models", key)).status).toBe(403);

    banLookupMode = "throw";
    expect((await request(app, "/v1/models", key)).status).toBe(403);
    expect(served).toBe(0);
  });
});
