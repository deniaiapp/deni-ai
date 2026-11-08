import { eq, inArray, sql } from "drizzle-orm";
import { user } from "@deniai/db";
import type { RunDatabase } from "../runtime";
import { decryptSecretWith, isEncryptedSecret } from "../data/secrets";
import {
  type MigrationKeys,
  planUser,
  rehearsalUserId,
  TARGET_TABLES,
  type TargetTable,
  type UserPlan,
} from "./map";
import type { SourceData, SourceUserData } from "./source";
import { columnsOf, rowKey, TABLE_SPECS, type TableSpec } from "./tables";

export {
  FINISHED_JOB_STATUSES,
  legacyStorageKey,
  legacyWorkspaceObjectKey,
  MissingSourceKeyError,
  rehearsalUserId,
  type MigrationKeys,
} from "./map";
export { openSource, readSource, type SourceData } from "./source";

/**
 * Migration of the standalone Deni Run (Cloudflare D1 / local SQLite) into the
 * platform's `run_*` tables. See docs/run-migration.md for the production runbook.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class MigrationGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationGuardError";
  }
}

/** The host of a Postgres URL (`postgresql://user@host:port/db`). */
export function targetHost(url: string) {
  const parsed = new URL(url);
  const socketHost = parsed.searchParams.get("host");
  return (socketHost ?? parsed.hostname).toLowerCase();
}

export function isLocalTarget(url: string) {
  return LOCAL_HOSTS.has(targetHost(url));
}

export type GuardOptions = {
  production?: boolean;
  createPlaceholderUsers?: boolean;
  rehearsalLinkUnlinked?: boolean;
  map?: Record<string, string>;
};

/**
 * Refuse a non-local target unless `--i-know-this-is-production`; the rehearsal options
 * (placeholder users, assumed links, explicit maps) only ever run against localhost.
 */
export function assertTargetAllowed(url: string, options: GuardOptions) {
  const local = isLocalTarget(url);
  if (!local && !options.production)
    throw new MigrationGuardError(
      `Refusing to migrate into ${targetHost(url)}: not localhost. Pass --i-know-this-is-production to migrate a production database.`,
    );
  const rehearsal = [
    options.createPlaceholderUsers && "--create-placeholder-users",
    options.rehearsalLinkUnlinked && "--rehearsal-link-unlinked",
    options.map && Object.keys(options.map).length > 0 && "--map",
  ].filter(Boolean);
  if (!local && rehearsal.length)
    throw new MigrationGuardError(`${rehearsal.join(", ")} only run against a localhost database.`);
}

export type TableCounts = Partial<
  Record<TargetTable, { planned: number; inserted: number; existing: number }>
>;

export type UserReport = {
  runUserId: string;
  deniUserId: string | null;
  link: "deni-ai" | "map" | "rehearsal" | "none";
  status:
    | "migrated"
    | "planned"
    | "unlinked"
    | "missing-target-user"
    | "duplicate-target"
    | "error";
  placeholderCreated?: boolean;
  error?: string;
  counts: TableCounts;
  skippedJobs: { id: string; status: string }[];
  skipped: UserPlan["skipped"];
  reencryptedSecrets: number;
  ignoredFields: string[];
};

export type MigrationReport = {
  dryRun: boolean;
  users: UserReport[];
  totals: Record<string, { planned: number; inserted: number; existing: number }>;
  unlinkedUsers: string[];
  skippedJobs: { runUserId: string; id: string; status: string }[];
  reencryptedSecrets: number;
  placeholderUsers: string[];
  notMigrated: Record<string, number>;
  ok: boolean;
};

export type MigrationOptions = GuardOptions & {
  source: SourceData;
  db: RunDatabase;
  /** The target URL (for the guard and the report). Tests pass a localhost URL. */
  targetUrl: string;
  keys: MigrationKeys;
  dryRun?: boolean;
  now?: Date;
};

type Resolved = { data: SourceUserData; deniUserId: string | null; link: UserReport["link"] };

function resolveUsers(options: MigrationOptions): Resolved[] {
  return options.source.users.map((data) => {
    const mapped = options.map?.[data.user.id];
    if (mapped) return { data, deniUserId: mapped, link: "map" };
    if (data.deniUserId) return { data, deniUserId: data.deniUserId, link: "deni-ai" };
    if (options.rehearsalLinkUnlinked)
      return { data, deniUserId: rehearsalUserId(data.user.id), link: "rehearsal" };
    return { data, deniUserId: null, link: "none" };
  });
}

async function existingUsers(db: RunDatabase, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db.select({ id: user.id }).from(user).where(inArray(user.id, ids));
  return new Set(rows.map((row) => row.id));
}

async function createPlaceholderUser(db: RunDatabase, id: string, name: string) {
  const now = new Date();
  await db
    .insert(user)
    .values({
      id,
      name: name || "Deni Run user",
      email: `${id}@placeholder.invalid`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

type Database = Pick<RunDatabase, "insert" | "select">;

/** Upsert rows; returns how many were new and how many existed (rewritten). */
async function upsert(database: Database, spec: TableSpec, rows: Record<string, unknown>[]) {
  let inserted = 0;
  let existing = 0;
  if (!rows.length) return { inserted, existing };
  const columns = columnsOf(spec);
  const target = spec.keys.map((key) => columns[key]);
  const updatable = Object.keys(rows[0]!).filter(
    (key) => !spec.keys.includes(key) && !(spec.keep ?? []).includes(key) && columns[key],
  );
  const set = Object.fromEntries(
    updatable.map((key) => [key, sql.raw(`excluded."${columns[key].name as string}"`)]),
  );
  const userColumn = columns.userId;
  for (let index = 0; index < rows.length; index += 200) {
    const chunk = rows.slice(index, index + 200);
    const query = database.insert(spec.table).values(chunk);
    const result = await (
      updatable.length
        ? query.onConflictDoUpdate({
            target,
            set,
            // Never take over a row of another account that happens to share a global id.
            ...(userColumn && !spec.keys.includes("userId")
              ? { setWhere: sql`${userColumn} = excluded."user_id"` }
              : {}),
          })
        : query.onConflictDoNothing({ target })
    ).returning({ inserted: sql<boolean>`(xmax = 0)` });
    for (const row of result) {
      if (row.inserted) inserted++;
      else existing++;
    }
    if (!updatable.length) existing += chunk.length - result.length;
  }
  return { inserted, existing };
}

async function writePlan(db: RunDatabase, plan: UserPlan): Promise<TableCounts> {
  return db.transaction(async (tx) => {
    const counts: TableCounts = {};
    for (const table of TARGET_TABLES) {
      const rows = plan.rows[table] as unknown as Record<string, unknown>[];
      const result = await upsert(tx, TABLE_SPECS[table], rows);
      counts[table] = { planned: rows.length, ...result };
    }
    return counts;
  });
}

function plannedCounts(plan: UserPlan): TableCounts {
  return Object.fromEntries(
    TARGET_TABLES.map((table) => [
      table,
      { planned: plan.rows[table].length, inserted: 0, existing: 0 },
    ]),
  );
}

/** Migrate every linked Run user. Each user is written in one transaction. */
export async function migrateRun(options: MigrationOptions): Promise<MigrationReport> {
  assertTargetAllowed(options.targetUrl, options);
  const now = options.now ?? new Date();
  const resolved = resolveUsers(options);
  const present = await existingUsers(
    options.db,
    resolved.flatMap((item) => (item.deniUserId ? [item.deniUserId] : [])),
  );
  const claimed = new Set<string>();
  const reports: UserReport[] = [];
  const placeholderUsers: string[] = [];

  for (const { data, deniUserId, link } of resolved) {
    const base: UserReport = {
      runUserId: data.user.id,
      deniUserId,
      link,
      status: "unlinked",
      counts: {},
      skippedJobs: [],
      skipped: [],
      reencryptedSecrets: 0,
      ignoredFields: [],
    };
    if (!deniUserId) {
      reports.push(base);
      continue;
    }
    if (claimed.has(deniUserId)) {
      reports.push({
        ...base,
        status: "duplicate-target",
        error: "another Run user maps to the same Deni AI user",
      });
      continue;
    }
    claimed.add(deniUserId);
    let plan: UserPlan;
    try {
      plan = planUser(data, deniUserId, options.keys, now);
    } catch (error) {
      reports.push({ ...base, status: "error", error: (error as Error).message });
      continue;
    }
    const report: UserReport = {
      ...base,
      status: options.dryRun ? "planned" : "migrated",
      counts: plannedCounts(plan),
      skippedJobs: plan.skippedJobs,
      skipped: plan.skipped,
      reencryptedSecrets: plan.reencryptedSecrets,
      ignoredFields: plan.ignoredFields,
    };
    if (!present.has(deniUserId)) {
      const mayCreate = link === "rehearsal" || options.createPlaceholderUsers;
      if (!mayCreate) {
        reports.push({ ...report, status: "missing-target-user", counts: {} });
        continue;
      }
      report.placeholderCreated = true;
      placeholderUsers.push(deniUserId);
      if (!options.dryRun) await createPlaceholderUser(options.db, deniUserId, data.user.name);
    }
    if (!options.dryRun) {
      try {
        report.counts = await writePlan(options.db, plan);
      } catch (error) {
        report.status = "error";
        report.error = (error as Error).message;
      }
    }
    reports.push(report);
  }

  const totals: MigrationReport["totals"] = {};
  for (const report of reports)
    for (const [table, value] of Object.entries(report.counts)) {
      const name = TABLE_SPECS[table as TargetTable].name;
      const total = (totals[name] ??= { planned: 0, inserted: 0, existing: 0 });
      total.planned += value.planned;
      total.inserted += value.inserted;
      total.existing += value.existing;
    }
  return {
    dryRun: Boolean(options.dryRun),
    users: reports,
    totals,
    unlinkedUsers: reports
      .filter((item) => item.status === "unlinked")
      .map((item) => item.runUserId),
    skippedJobs: reports.flatMap((item) =>
      item.skippedJobs.map((job) => ({ runUserId: item.runUserId, ...job })),
    ),
    reencryptedSecrets: reports.reduce((sum, item) => sum + item.reencryptedSecrets, 0),
    placeholderUsers,
    notMigrated: options.source.notMigrated,
    ok: !reports.some((item) => item.status === "error" || item.status === "duplicate-target"),
  };
}

/** JSON with sorted keys, so jsonb's key reordering does not count as a difference. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof Date))
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  return JSON.stringify(value ?? null);
}

export type VerifyReport = {
  ok: boolean;
  users: {
    runUserId: string;
    deniUserId: string;
    counts: Record<string, { expected: number; found: number; missing: number }>;
    spotChecks: number;
  }[];
  /** Run users without a target account (unlinked or missing): nothing to compare. */
  notMigrated: string[];
  mismatches: string[];
};

function sample<T>(items: T[], size: number) {
  if (items.length <= size) return items;
  const step = items.length / size;
  return Array.from({ length: size }, (_, index) => items[Math.floor(index * step)]!);
}

function decryptOrPlain(key: Buffer | null, value: string | null | undefined) {
  if (!value) return null;
  if (!isEncryptedSecret(value)) return value;
  if (!key) return undefined;
  return decryptSecretWith(key, value);
}

/**
 * Compare source and target: every planned row must exist for the user (by key), and a
 * sample of contents must match (message parts, teammate instructions, thread titles,
 * job status, artifact object keys, storage key, decrypted MCP secrets with the new key).
 */
export async function verifyMigration(
  options: Omit<MigrationOptions, "dryRun" | "createPlaceholderUsers">,
): Promise<VerifyReport> {
  assertTargetAllowed(options.targetUrl, { ...options, createPlaceholderUsers: false });
  const now = options.now ?? new Date();
  const mismatches: string[] = [];
  const users: VerifyReport["users"] = [];
  const resolved = resolveUsers(options);
  const present = await existingUsers(
    options.db,
    resolved.flatMap((item) => (item.deniUserId ? [item.deniUserId] : [])),
  );
  const notMigrated: string[] = [];
  for (const { data, deniUserId } of resolved) {
    // Unlinked users and links to missing accounts were reported, not migrated.
    if (!deniUserId || !present.has(deniUserId)) {
      notMigrated.push(data.user.id);
      continue;
    }
    const plan = planUser(data, deniUserId, options.keys, now);
    const counts: VerifyReport["users"][number]["counts"] = {};
    const found: Partial<Record<TargetTable, Map<string, Record<string, unknown>>>> = {};
    for (const table of TARGET_TABLES) {
      const spec = TABLE_SPECS[table];
      const columns = columnsOf(spec);
      const rows = (await options.db
        .select()
        .from(spec.table)
        .where(eq(columns.userId, deniUserId))) as Record<string, unknown>[];
      const byKey = new Map(rows.map((row) => [rowKey(spec, row), row]));
      found[table] = byKey;
      const expected = (plan.rows[table] as unknown as Record<string, unknown>[]).map((row) =>
        rowKey(spec, row),
      );
      const missing = expected.filter((key) => !byKey.has(key));
      counts[spec.name] = {
        expected: expected.length,
        found: rows.length,
        missing: missing.length,
      };
      if (missing.length)
        mismatches.push(`${data.user.id}: ${missing.length} ${spec.name} row(s) missing`);
    }
    let spotChecks = 0;
    const check = (label: string, equal: boolean) => {
      spotChecks++;
      if (!equal) mismatches.push(`${data.user.id}: ${label} differs`);
    };
    const get = (table: TargetTable, row: Record<string, unknown>) =>
      found[table]?.get(rowKey(TABLE_SPECS[table], row));
    for (const message of sample(plan.rows.messages, 10)) {
      const target = get("messages", message);
      if (target)
        check(
          `message ${message.id}`,
          stableJson([message.role, message.parts, message.metadata]) ===
            stableJson([target.role, target.parts, target.metadata]),
        );
    }
    for (const teammate of plan.rows.teammates) {
      const target = get("teammates", teammate);
      if (target)
        check(
          `teammate ${teammate.id}`,
          target.name === teammate.name && target.instructions === teammate.instructions,
        );
    }
    for (const thread of plan.rows.threads) {
      const target = get("threads", thread);
      if (target) check(`thread ${thread.id}`, target.title === thread.title);
    }
    for (const job of sample(plan.rows.jobs, 10)) {
      const target = get("jobs", job);
      if (target) check(`job ${job.id}`, target.status === job.status);
    }
    for (const artifact of plan.rows.artifacts) {
      const target = get("artifacts", artifact);
      if (target) check(`artifact ${artifact.id}`, target.objectKey === artifact.objectKey);
    }
    for (const settings of plan.rows.settings) {
      const target = get("settings", settings);
      if (target) check("storage key", target.storageKey === settings.storageKey);
    }
    for (const connection of data.mcpConnections) {
      const target = found.mcpConnections?.get(
        rowKey(TABLE_SPECS.mcpConnections, { id: connection.id }),
      );
      if (!target) continue;
      for (const [label, source, stored] of [
        ["auth secret", connection.authSecret, target.authSecret],
        ["oauth", connection.oauth, target.oauth],
      ] as const) {
        const plain = decryptOrPlain(options.keys.source, source);
        if (plain === undefined) continue; // no source key: cannot compare
        let roundTrip: string | null = null;
        try {
          roundTrip = stored ? decryptSecretWith(options.keys.target, String(stored)) : null;
        } catch {
          roundTrip = "<undecryptable>";
        }
        check(`MCP ${connection.id} ${label}`, roundTrip === plain);
      }
    }
    users.push({ runUserId: data.user.id, deniUserId, counts, spotChecks });
  }
  return { ok: mismatches.length === 0, users, notMigrated, mismatches };
}
