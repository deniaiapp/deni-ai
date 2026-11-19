import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRunTestDb, resetRunTables, seedTestUser, type RunTestDb } from "../testing";
import { decryptSecretWith, encryptSecretWith } from "../data/secrets";
import type { RunDatabase } from "../runtime";
import { FIXTURE, writeRunFixture } from "./fixture";
import {
  assertTargetAllowed,
  legacyStorageKey,
  MigrationGuardError,
  migrateRun,
  openSource,
  readSource,
  rehearsalUserId,
  verifyMigration,
  type SourceData,
} from "./index";

const TARGET = "postgresql://postgres@localhost:5440/test";
const sourceKey = Buffer.alloc(32, 1);
const targetKey = Buffer.alloc(32, 2);
const keys = { source: sourceKey, target: targetKey };

let testDb: RunTestDb;
let db: RunDatabase;
let dir: string;
let paths: { sqlitePath: string; exportPath: string };
let source: SourceData;

function loadSource(filePath: string) {
  const sourceDb = openSource(filePath);
  try {
    return readSource(sourceDb);
  } finally {
    sourceDb.close();
  }
}

beforeAll(async () => {
  testDb = await createRunTestDb();
  db = testDb.db as unknown as RunDatabase;
  dir = mkdtempSync(join(tmpdir(), "run-migration-"));
  paths = writeRunFixture(dir, sourceKey);
  source = loadSource(paths.sqlitePath);
}, 60_000);

afterAll(async () => {
  await testDb.pglite.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetRunTables(testDb.pglite);
  await seedTestUser(testDb.pglite, FIXTURE.linked.deniUserId);
});

async function count(table: string, userId = FIXTURE.linked.deniUserId) {
  const result = await testDb.pglite.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0]!.n;
}

describe("Deni Run D1 migration", () => {
  it("migrates linked users and reports unlinked users, missing targets and in-flight jobs", async () => {
    const report = await migrateRun({ source, db, targetUrl: TARGET, keys });
    expect(report.ok).toBe(true);
    const byRunUser = Object.fromEntries(report.users.map((item) => [item.runUserId, item]));
    expect(byRunUser[FIXTURE.linked.runUserId]).toMatchObject({
      status: "migrated",
      deniUserId: FIXTURE.linked.deniUserId,
      link: "deni-ai",
    });
    expect(byRunUser[FIXTURE.linkedMissing.runUserId]?.status).toBe("missing-target-user");
    expect(report.unlinkedUsers).toEqual([FIXTURE.unlinked.runUserId]);
    expect(report.skippedJobs).toEqual([
      { runUserId: FIXTURE.linked.runUserId, id: FIXTURE.runningJobId, status: "running" },
    ]);
    expect(report.notMigrated).toEqual({ rate_limits: 1 });
    expect(byRunUser[FIXTURE.linked.runUserId]?.ignoredFields).toEqual(["billing", "usage"]);

    expect(await count("run_teammates")).toBe(2);
    expect(await count("run_teammate_memories")).toBe(1);
    expect(await count("run_threads")).toBe(3);
    // The deleted "ghost" teammate is dropped from the group.
    expect(await count("run_thread_participants")).toBe(4);
    expect(await count("run_routines")).toBe(1);
    expect(await count("run_jobs")).toBe(2);
    expect(await count("run_job_events")).toBe(3);
    expect(await count("run_browser_workspaces")).toBe(1);
    expect(await count("run_discord_link_codes")).toBe(1);
    expect(await count("run_teammates", FIXTURE.linkedMissing.deniUserId)).toBe(0);

    const teammates = await testDb.pglite.query<{
      id: string;
      tools: string[] | null;
      computer_access: boolean;
    }>(
      `SELECT id, tools, computer_access FROM run_teammates WHERE user_id = $1 ORDER BY position`,
      [FIXTURE.linked.deniUserId],
    );
    expect(teammates.rows).toEqual([
      { id: "chief", tools: null, computer_access: true },
      { id: "research", tools: ["web", "files"], computer_access: false },
    ]);

    const messages = await testDb.pglite.query<{ id: string; role: string; parts: unknown }>(
      `SELECT id, role, parts FROM run_messages WHERE user_id = $1 AND thread_id = 'dm_chief' ORDER BY seq`,
      [FIXTURE.linked.deniUserId],
    );
    expect(messages.rows.map((row) => row.role)).toEqual(["user", "assistant", "user"]);
    expect(messages.rows[0]?.id).toBe(`${FIXTURE.linked.runUserId}-m1`);
    expect(messages.rows[2]?.id).toMatch(/^legacy-message:2:/);
    expect(await count("run_messages")).toBe(3); // the deleted thread's messages are skipped

    const artifacts = await testDb.pglite.query<{
      id: string;
      job_id: string | null;
      object_key: string;
    }>(`SELECT id, job_id, object_key FROM run_artifacts ORDER BY id`);
    const prefix = `users/${legacyStorageKey(FIXTURE.linked.runUserId)}/workspace/`;
    expect(artifacts.rows).toEqual([
      { id: "art_1", job_id: "job_done", object_key: `${prefix}outbox/report.md` },
      { id: "art_2", job_id: null, object_key: `${prefix}notes/draft.md` },
    ]);
    const settings = await testDb.pglite.query<{
      storage_key: string;
      computer: Record<string, unknown>;
      discord_notify: boolean;
    }>(`SELECT storage_key, computer, discord_notify FROM run_settings WHERE user_id = $1`, [
      FIXTURE.linked.deniUserId,
    ]);
    expect(settings.rows[0]).toMatchObject({
      storage_key: legacyStorageKey(FIXTURE.linked.runUserId),
      discord_notify: false,
      computer: {
        status: "idle",
        e2bSandboxId: null,
        steelSessionId: null,
        steelProfileId: "steel_profile",
      },
    });
  });

  it("re-encrypts secrets from the old key to the new key", async () => {
    const report = await migrateRun({ source, db, targetUrl: TARGET, keys });
    expect(report.reencryptedSecrets).toBe(4); // BYOK key, MCP auth secret, OAuth state, one header
    const mcp = await testDb.pglite.query<{
      auth_secret: string;
      oauth: string;
      headers: Record<string, string>;
    }>(`SELECT auth_secret, oauth, headers FROM run_mcp_connections WHERE id = 'mcp_1'`);
    const row = mcp.rows[0]!;
    expect(decryptSecretWith(targetKey, row.auth_secret)).toBe(FIXTURE.mcpSecret);
    expect(JSON.parse(decryptSecretWith(targetKey, row.oauth))).toEqual({
      accessToken: "oauth-token",
    });
    expect(decryptSecretWith(targetKey, row.headers["X-Api-Key"]!)).toBe(FIXTURE.mcpHeader);
    expect(() => decryptSecretWith(sourceKey, row.auth_secret)).toThrow();
    const settings = await testDb.pglite.query<{ openrouter_api_key: string }>(
      `SELECT openrouter_api_key FROM run_settings WHERE user_id = $1`,
      [FIXTURE.linked.deniUserId],
    );
    expect(decryptSecretWith(targetKey, settings.rows[0]!.openrouter_api_key)).toBe(
      FIXTURE.byokKey,
    );
  });

  it("refuses encrypted secrets without the source key", async () => {
    const report = await migrateRun({
      source,
      db,
      targetUrl: TARGET,
      keys: { source: null, target: targetKey },
    });
    const user = report.users.find((item) => item.runUserId === FIXTURE.linked.runUserId);
    expect(user?.status).toBe("error");
    expect(report.ok).toBe(false);
    expect(await count("run_teammates")).toBe(0);
  });

  it("is idempotent: a second run adds no rows", async () => {
    const first = await migrateRun({ source, db, targetUrl: TARGET, keys });
    const second = await migrateRun({ source, db, targetUrl: TARGET, keys });
    const inserted = Object.values(second.totals).reduce((sum, value) => sum + value.inserted, 0);
    expect(inserted).toBe(0);
    for (const [table, value] of Object.entries(second.totals))
      expect(value.existing, table).toBe(first.totals[table]!.inserted);
    expect(await count("run_messages")).toBe(3);
  });

  it("writes nothing on a dry run", async () => {
    const report = await migrateRun({ source, db, targetUrl: TARGET, keys, dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.totals.run_messages?.planned).toBe(3);
    expect(await count("run_settings")).toBe(0);
    expect(await count("run_messages")).toBe(0);
  });

  it("verifies a migration and detects a tampered row", async () => {
    await migrateRun({ source, db, targetUrl: TARGET, keys });
    const ok = await verifyMigration({ source, db, targetUrl: TARGET, keys });
    expect(ok.mismatches).toEqual([]);
    expect(ok.ok).toBe(true);
    expect(ok.users[0]?.spotChecks).toBeGreaterThan(5);

    await testDb.pglite.query(
      `UPDATE run_messages SET parts = '[{"type":"text","text":"tampered"}]'::jsonb WHERE id = $1`,
      [`${FIXTURE.linked.runUserId}-m2`],
    );
    await testDb.pglite.query(`DELETE FROM run_skills WHERE user_id = $1`, [
      FIXTURE.linked.deniUserId,
    ]);
    const bad = await verifyMigration({ source, db, targetUrl: TARGET, keys });
    expect(bad.ok).toBe(false);
    expect(bad.mismatches).toEqual(
      expect.arrayContaining([
        `${FIXTURE.linked.runUserId}: 1 run_skills row(s) missing`,
        `${FIXTURE.linked.runUserId}: message ${FIXTURE.linked.runUserId}-m2 differs`,
      ]),
    );
  });

  it("creates placeholder users and assumed links only on rehearsals", async () => {
    const report = await migrateRun({
      source,
      db,
      targetUrl: TARGET,
      keys,
      createPlaceholderUsers: true,
      rehearsalLinkUnlinked: true,
    });
    const rehearsalId = rehearsalUserId(FIXTURE.unlinked.runUserId);
    expect(report.placeholderUsers.sort()).toEqual(
      [FIXTURE.linkedMissing.deniUserId, rehearsalId].sort(),
    );
    expect(report.unlinkedUsers).toEqual([]);
    expect(await count("run_teammates", rehearsalId)).toBe(2);
    expect(await count("run_teammates", FIXTURE.linkedMissing.deniUserId)).toBe(2);
    expect(await count("run_teammate_memories", FIXTURE.linked.deniUserId)).toBe(1);
    expect(await count("run_teammate_memories", FIXTURE.linkedMissing.deniUserId)).toBe(1);
    expect(await count("run_teammate_memories", rehearsalId)).toBe(1);

    const verify = await verifyMigration({
      source,
      db,
      targetUrl: TARGET,
      keys,
      rehearsalLinkUnlinked: true,
    });
    expect(verify.ok).toBe(true);
    expect(verify.mismatches).toEqual([]);
  });

  it("maps a Run user explicitly to a chosen account", async () => {
    await seedTestUser(testDb.pglite, "trial-account");
    const report = await migrateRun({
      source,
      db,
      targetUrl: TARGET,
      keys,
      map: { [FIXTURE.unlinked.runUserId]: "trial-account" },
    });
    expect(
      report.users.find((item) => item.runUserId === FIXTURE.unlinked.runUserId),
    ).toMatchObject({
      link: "map",
      status: "migrated",
    });
    expect(await count("run_threads", "trial-account")).toBe(3);
  });

  it("refuses non-local targets without the production flag, and rehearsal options there", async () => {
    const remote = "postgresql://user:pw@db.example.com:5432/app";
    expect(() => assertTargetAllowed(remote, {})).toThrow(MigrationGuardError);
    expect(() => assertTargetAllowed(remote, { production: true })).not.toThrow();
    expect(() =>
      assertTargetAllowed(remote, { production: true, createPlaceholderUsers: true }),
    ).toThrow(MigrationGuardError);
    expect(() => assertTargetAllowed(remote, { production: true, map: { a: "b" } })).toThrow(
      MigrationGuardError,
    );
    expect(() => assertTargetAllowed("postgresql://postgres@127.0.0.1/x", {})).not.toThrow();
    await expect(migrateRun({ source, db, targetUrl: remote, keys })).rejects.toBeInstanceOf(
      MigrationGuardError,
    );
  });

  it("reads a wrangler d1 export (.sql) the same as the SQLite file", async () => {
    const fromExport = loadSource(paths.exportPath);
    expect(fromExport.users.map((item) => item.user.id)).toEqual(
      source.users.map((item) => item.user.id),
    );
    const report = await migrateRun({ source: fromExport, db, targetUrl: TARGET, keys });
    expect(report.ok).toBe(true);
    expect(await count("run_messages")).toBe(3);
    expect((await verifyMigration({ source, db, targetUrl: TARGET, keys })).ok).toBe(true);
  });

  it("detects tampered BYOK keys and encrypted MCP header secrets during verification", async () => {
    await migrateRun({ source, db, targetUrl: TARGET, keys });
    const badByok = encryptSecretWith(targetKey, "wrong-byok-key");
    const badHeader = encryptSecretWith(targetKey, "wrong-header-secret");
    await testDb.pglite.query(
      `UPDATE run_settings SET openrouter_api_key = $1 WHERE user_id = $2`,
      [badByok, FIXTURE.linked.deniUserId],
    );
    await testDb.pglite.query(
      `UPDATE run_mcp_connections SET headers = $1::jsonb WHERE id = 'mcp_1'`,
      [JSON.stringify({ "X-Api-Key": badHeader })],
    );

    const verify = await verifyMigration({ source, db, targetUrl: TARGET, keys });
    expect(verify.ok).toBe(false);
    expect(verify.mismatches).toEqual(
      expect.arrayContaining([
        `${FIXTURE.linked.runUserId}: openrouter api key differs`,
        `${FIXTURE.linked.runUserId}: MCP mcp_1 header X-Api-Key differs`,
      ]),
    );
  });

  it("creates a minimal run_settings row preserving storage_key when a user has artifacts but no user_stores row", async () => {
    await seedTestUser(testDb.pglite, "deni-no-store");
    const minimalSource: SourceData = {
      users: [
        {
          user: {
            id: "run-no-store",
            name: "No Store",
            email: "nostore@example.com",
            emailVerified: true,
          },
          deniUserId: "deni-no-store",
          store: null,
          threadMessages: [],
          jobs: [],
          jobEvents: [],
          artifacts: [
            {
              id: "art_only",
              userId: "run-no-store",
              jobId: null,
              threadId: "dm_chief",
              botId: "chief",
              path: "outbox/notes.txt",
              title: "Notes",
              mimeType: "text/plain",
              description: null,
              createdAt: new Date("2026-10-01T00:00:00.000Z"),
              updatedAt: new Date("2026-10-01T00:00:00.000Z"),
            },
          ],
          browserWorkspaces: [],
          mcpConnections: [],
          mcpExplanations: [],
          notifications: [],
          discordLink: null,
          discordLinkCodes: [],
        },
      ],
      notMigrated: {},
    };

    const report = await migrateRun({ source: minimalSource, db, targetUrl: TARGET, keys });
    expect(report.ok).toBe(true);
    const settings = await testDb.pglite.query<{ storage_key: string }>(
      `SELECT storage_key FROM run_settings WHERE user_id = 'deni-no-store'`,
    );
    expect(settings.rows).toEqual([{ storage_key: legacyStorageKey("run-no-store") }]);
    expect((await verifyMigration({ source: minimalSource, db, targetUrl: TARGET, keys })).ok).toBe(
      true,
    );
  });

  it("ignores sqlite_sequence statements in standalone SQL dumps even without AUTOINCREMENT tables", () => {
    const dumpPath = join(dir, "d1-sequence.sql");
    writeFileSync(
      dumpPath,
      [
        "PRAGMA defer_foreign_keys=TRUE;",
        'CREATE TABLE "sqlite_sequence"(name,seq);',
        'CREATE TABLE "user" ("id" text PRIMARY KEY NOT NULL, "name" text NOT NULL, "email" text NOT NULL);',
        `INSERT INTO "user" VALUES('u_seq','Seq User','seq@example.com');`,
        "DELETE FROM sqlite_sequence;",
        `INSERT INTO "sqlite_sequence" VALUES('d1_migrations',1);`,
      ].join("\n"),
    );

    const parsed = loadSource(dumpPath);
    expect(parsed.users.map((entry) => entry.user)).toEqual([
      { id: "u_seq", name: "Seq User", email: "seq@example.com", emailVerified: false },
    ]);
  });

  it("loads a D1 SQL dump when child tables with REFERENCES user(id) precede the user table", () => {
    const dumpPath = join(dir, "d1-child-before-user.sql");
    writeFileSync(
      dumpPath,
      [
        "PRAGMA defer_foreign_keys=TRUE;",
        'CREATE TABLE "account" ("id" text PRIMARY KEY NOT NULL, "account_id" text NOT NULL, "provider_id" text NOT NULL, "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE);',
        `INSERT INTO "account" VALUES('acc_1','deni_target_1','deni-ai','run_u_1');`,
        'CREATE TABLE "user" ("id" text PRIMARY KEY NOT NULL, "name" text NOT NULL, "email" text NOT NULL);',
        `INSERT INTO "user" VALUES('run_u_1','Order User','order@example.com');`,
      ].join("\n"),
    );

    const parsed = loadSource(dumpPath);
    expect(parsed.users).toHaveLength(1);
    expect(parsed.users[0]?.user).toEqual({
      id: "run_u_1",
      name: "Order User",
      email: "order@example.com",
      emailVerified: false,
    });
    expect(parsed.users[0]?.deniUserId).toBe("deni_target_1");
  });

  it("matches unlinked verified-email Run users only to unique verified non-anonymous Deni AI accounts", async () => {
    const dumpPath = join(dir, "d1-verified-email.sql");
    writeFileSync(
      dumpPath,
      [
        'CREATE TABLE "user" ("id" text PRIMARY KEY NOT NULL, "name" text NOT NULL, "email" text NOT NULL, "email_verified" integer DEFAULT 0 NOT NULL);',
        'CREATE TABLE "account" ("id" text PRIMARY KEY NOT NULL, "account_id" text NOT NULL, "provider_id" text NOT NULL, "user_id" text NOT NULL);',
        'CREATE TABLE "user_stores" ("user_id" text PRIMARY KEY NOT NULL, "data" text NOT NULL, "created_at" integer NOT NULL, "updated_at" integer NOT NULL);',
        `INSERT INTO "user" VALUES('run_match','Match User','MATCH@example.com',1);`,
        `INSERT INTO "user" VALUES('run_unverified_src','Unverified Src','unverified-src@example.com',0);`,
        `INSERT INTO "user" VALUES('run_unverified_dst','Unverified Dst','unverified-dst@example.com',1);`,
        `INSERT INTO "user" VALUES('run_anon_dst','Anon Dst','anon-dst@example.com',1);`,
        `INSERT INTO "user" VALUES('run_dup','Dup User','deni-1@example.com',1);`,
        `INSERT INTO "account" VALUES('acc_dup','deni-1','deni-ai','${FIXTURE.linked.runUserId}');`,
        `INSERT INTO "user_stores" VALUES('run_match','{"version":1,"config":{"apiKey":"","timezone":"UTC","model":"run","runMode":"default"},"bots":[{"id":"chief","name":"Chief","job":"","instructions":"Matched","accent":"#d4a574","icon":null,"createdAt":"2026-10-01T00:00:00.000Z","updatedAt":"2026-10-01T00:00:00.000Z","memory":[]}],"threads":[{"id":"dm_chief","kind":"dm","title":"Chief","botIds":["chief"],"createdAt":"2026-10-01T00:00:00.000Z","updatedAt":"2026-10-01T00:00:00.000Z","lastPreview":""}],"skills":[],"routines":[],"shells":[],"handoffs":[]}',1,1);`,
        `INSERT INTO "user_stores" VALUES('run_dup','{"version":1,"config":{"apiKey":"","timezone":"UTC","model":"run","runMode":"default"},"bots":[],"threads":[],"skills":[],"routines":[],"shells":[],"handoffs":[]}',1,1);`,
      ].join("\n"),
    );

    await testDb.pglite.query(
      `INSERT INTO "user" (id, name, email, email_verified, is_anonymous) VALUES
        ('deni-match', 'Match', 'match@example.com', true, false),
        ('deni-unv-src', 'Unv Src', 'unverified-src@example.com', true, false),
        ('deni-unv-dst', 'Unv Dst', 'unverified-dst@example.com', false, false),
        ('deni-anon-dst', 'Anon Dst', 'anon-dst@example.com', true, true)`,
    );

    const parsed = loadSource(dumpPath);
    const report = await migrateRun({
      source: {
        ...parsed,
        users: [
          ...source.users.filter((u) => u.user.id === FIXTURE.linked.runUserId),
          ...parsed.users,
        ],
      },
      db,
      targetUrl: TARGET,
      keys,
      matchVerifiedEmail: true,
    });

    const byRun = Object.fromEntries(report.users.map((item) => [item.runUserId, item]));
    expect(byRun.run_match).toMatchObject({ link: "verified-email", status: "migrated" });
    expect(byRun.run_unverified_src).toMatchObject({ link: "none", status: "unlinked" });
    expect(byRun.run_unverified_dst).toMatchObject({ link: "none", status: "unlinked" });
    expect(byRun.run_anon_dst).toMatchObject({ link: "none", status: "unlinked" });
    expect(byRun.run_dup).toMatchObject({ link: "verified-email", status: "duplicate-target" });
    expect(await count("run_teammates", "deni-match")).toBe(1);

    const verify = await verifyMigration({
      source: {
        ...parsed,
        users: [
          ...source.users.filter((u) => u.user.id === FIXTURE.linked.runUserId),
          ...parsed.users,
        ],
      },
      db,
      targetUrl: TARGET,
      keys,
      matchVerifiedEmail: true,
    });
    expect(verify.ok).toBe(true);
    expect(verify.mismatches).toEqual([]);
  });
});
