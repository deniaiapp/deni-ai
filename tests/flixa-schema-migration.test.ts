import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { migrateFlixa } from "./helpers/flixa-db";

// Earlier releases created these tables in public at runtime.
const LEGACY_TABLES = `
  CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '');
  CREATE TABLE flixa_ban (
    user_id TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    client_headers JSONB,
    banned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX flixa_ban_banned_at_idx ON flixa_ban (banned_at DESC);
  CREATE TABLE flixa_silent_ban_rule (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    hits_before_ban INT NOT NULL DEFAULT 3,
    reason TEXT NOT NULL DEFAULT 'silent_ban_rule',
    conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE flixa_silent_ban_hit (
    user_id TEXT NOT NULL,
    rule_id TEXT NOT NULL REFERENCES flixa_silent_ban_rule(id) ON DELETE CASCADE,
    hit_count INT NOT NULL DEFAULT 0,
    first_hit_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_hit_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, rule_id)
  );
  CREATE INDEX flixa_silent_ban_hit_rule_idx ON flixa_silent_ban_hit (rule_id);
  CREATE INDEX flixa_silent_ban_rule_enabled_idx ON flixa_silent_ban_rule (enabled) WHERE enabled = TRUE;
  CREATE TABLE flixa_usage_reservation (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    plan_tier TEXT NOT NULL,
    period_start TEXT NOT NULL,
    amount BIGINT NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO "user" (id) VALUES ('kept');
  INSERT INTO flixa_ban (user_id, reason) VALUES ('kept', 'manual'), ('deleted', 'manual');
  INSERT INTO flixa_silent_ban_rule (id, name) VALUES ('rule-1', 'codex');
  INSERT INTO flixa_silent_ban_hit (user_id, rule_id, hit_count)
    VALUES ('kept', 'rule-1', 2), ('deleted', 'rule-1', 1);
  INSERT INTO flixa_usage_reservation (id, user_id, category, plan_tier, period_start, amount)
    VALUES (gen_random_uuid(), 'kept', 'basic', 'free', '0', 10),
           (gen_random_uuid(), 'deleted', 'basic', 'free', '0', 10);
`;

describe("flixa schema migration", () => {
  const db = new PGlite();

  before(async () => {
    await db.exec(LEGACY_TABLES);
    await migrateFlixa(db);
  });

  after(async () => {
    await db.close();
  });

  test("moves the runtime-created tables out of public", async () => {
    const tables = await db.query<{ schema: string; name: string }>(
      `SELECT table_schema AS schema, table_name AS name FROM information_schema.tables
       WHERE table_name LIKE '%ban%' OR table_name LIKE '%reservation%' ORDER BY 1, 2`,
    );
    assert.deepEqual(tables.rows, [
      { schema: "flixa", name: "ban" },
      { schema: "flixa", name: "silent_ban_hit" },
      { schema: "flixa", name: "silent_ban_rule" },
      { schema: "flixa", name: "usage_reservation" },
    ]);
  });

  test("keeps rows of existing accounts and drops those of deleted ones", async () => {
    const rows = await db.query<{ source: string; user_id: string }>(
      `SELECT 'ban' AS source, user_id FROM flixa.ban
       UNION ALL SELECT 'hit', user_id FROM flixa.silent_ban_hit
       UNION ALL SELECT 'reservation', user_id FROM flixa.usage_reservation
       ORDER BY 1`,
    );
    assert.deepEqual(rows.rows, [
      { source: "ban", user_id: "kept" },
      { source: "hit", user_id: "kept" },
      { source: "reservation", user_id: "kept" },
    ]);
    const rule = await db.query("SELECT id FROM flixa.silent_ban_rule");
    assert.equal(rule.rows.length, 1);
  });

  test("uses the constraint and index names drizzle-kit generates", async () => {
    // NOT NULL constraints (Postgres 18+) keep their old names; drizzle-kit
    // changes them with SET/DROP NOT NULL, never by name.
    const constraints = await db.query<{ name: string }>(
      `SELECT conname AS name FROM pg_constraint
       WHERE connamespace = 'flixa'::regnamespace AND contype <> 'n'
         AND conrelid <> 'flixa.__drizzle_migrations'::regclass
       ORDER BY 1`,
    );
    assert.deepEqual(
      constraints.rows.map((row) => row.name),
      [
        "ban_pkey",
        "ban_user_id_user_id_fk",
        "silent_ban_hit_rule_id_silent_ban_rule_id_fk",
        "silent_ban_hit_user_id_rule_id_pk",
        "silent_ban_hit_user_id_user_id_fk",
        "silent_ban_rule_pkey",
        "usage_reservation_amount_check",
        "usage_reservation_pkey",
        "usage_reservation_user_id_user_id_fk",
      ],
    );
    const indexes = await db.query<{ name: string }>(
      `SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'flixa' ORDER BY 1`,
    );
    assert.deepEqual(
      indexes.rows.map((row) => row.name),
      [
        "__drizzle_migrations_pkey",
        "ban_banned_at_idx",
        "ban_pkey",
        "silent_ban_hit_rule_idx",
        "silent_ban_hit_user_id_rule_id_pk",
        "silent_ban_rule_enabled_idx",
        "silent_ban_rule_pkey",
        "usage_reservation_pkey",
      ],
    );
  });

  test("account deletion cascades to every Flixa table", async () => {
    await db.exec(`DELETE FROM "user" WHERE id = 'kept'`);
    const rows = await db.query(
      `SELECT user_id FROM flixa.ban UNION ALL SELECT user_id FROM flixa.silent_ban_hit
       UNION ALL SELECT user_id FROM flixa.usage_reservation`,
    );
    assert.equal(rows.rows.length, 0);
  });
});
