import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRunTestDb, resetRunTables, seedTestUser, type RunTestDb } from "../testing";
import { decryptSecretWith } from "../data/secrets";
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

beforeAll(async () => {
  testDb = await createRunTestDb();
  db = testDb.db as unknown as RunDatabase;
  dir = mkdtempSync(join(tmpdir(), "run-migration-"));
  paths = writeRunFixture(dir, sourceKey);
  source = readSource(openSource(paths.sqlitePath));
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
    const fromExport = readSource(openSource(paths.exportPath));
    expect(fromExport.users.map((item) => item.user.id)).toEqual(
      source.users.map((item) => item.user.id),
    );
    const report = await migrateRun({ source: fromExport, db, targetUrl: TARGET, keys });
    expect(report.ok).toBe(true);
    expect(await count("run_messages")).toBe(3);
    expect((await verifyMigration({ source, db, targetUrl: TARGET, keys })).ok).toBe(true);
  });
});
