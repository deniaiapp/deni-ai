/**
 * One-off copy of the production Postgres database into Cloudflare D1, through the
 * d1-proxy Worker.
 *
 *   SOURCE_DATABASE_URL=postgres://...  D1_PROXY_URL=https://...  D1_PROXY_TOKEN=...
 *   pnpm exec tsx scripts/migrate-pg-to-d1.ts [--dry-run] [--reset --yes]
 *
 * It is safe to run repeatedly before the cutover: rows are upserted by primary key, so a
 * rehearsal run followed by a final run during the maintenance window converges on the
 * source. Use --reset --yes to wipe the target first (needed to drop rows deleted since
 * a rehearsal). Ephemeral tables (rate_limits) are not copied.
 *
 * The app and the worker must be stopped while the final run executes.
 */
import dotenv from "dotenv";
import postgres from "postgres";
import { remoteExecutor } from "../src/db/remote-executor";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });

type Kind = "text" | "int" | "bool" | "ts" | "json";
type Column = readonly [name: string, kind: Kind];
type TableSpec = { table: string; key: string[]; columns: Column[] };

const t = (name: string): Column => [name, "text"];
const i = (name: string): Column => [name, "int"];
const b = (name: string): Column => [name, "bool"];
const ts = (name: string): Column => [name, "ts"];
const j = (name: string): Column => [name, "json"];

// Parents before children: D1 enforces foreign keys.
const TABLES: TableSpec[] = [
  { table: "user", key: ["id"], columns: [t("id"), t("name"), t("email"), b("email_verified"), t("image"), ts("created_at"), ts("updated_at"), b("two_factor_enabled")] },
  { table: "session", key: ["id"], columns: [t("id"), ts("expires_at"), t("token"), ts("created_at"), ts("updated_at"), t("ip_address"), t("user_agent"), t("user_id")] },
  { table: "account", key: ["id"], columns: [t("id"), t("issuer"), t("account_id"), t("provider_id"), t("user_id"), t("access_token"), t("refresh_token"), t("id_token"), ts("access_token_expires_at"), ts("refresh_token_expires_at"), t("scope"), t("password"), ts("created_at"), ts("updated_at")] },
  { table: "verification", key: ["id"], columns: [t("id"), t("identifier"), t("value"), ts("expires_at"), ts("created_at"), ts("updated_at")] },
  { table: "two_factor", key: ["id"], columns: [t("id"), t("secret"), t("backup_codes"), t("user_id"), b("verified"), i("failed_verification_count"), ts("locked_until")] },
  { table: "auth_rate_limit", key: ["id"], columns: [t("id"), t("key"), i("count"), i("last_request")] },
  { table: "user_stores", key: ["user_id"], columns: [t("user_id"), j("data"), ts("created_at"), ts("updated_at")] },
  { table: "thread_messages", key: ["user_id", "thread_id"], columns: [t("user_id"), t("thread_id"), j("messages"), ts("updated_at")] },
  { table: "agent_jobs", key: ["id"], columns: [t("id"), t("user_id"), t("thread_id"), t("bot_id"), t("kind"), t("status"), j("payload"), j("result"), j("checkpoint"), i("attempt"), i("max_attempts"), t("idempotency_key"), t("error"), ts("locked_at"), ts("heartbeat_at"), ts("started_at"), ts("finished_at"), ts("created_at"), ts("updated_at")] },
  { table: "job_events", key: ["id"], columns: [t("id"), t("user_id"), t("job_id"), t("kind"), j("payload"), i("sequence"), ts("created_at")] },
  { table: "browser_workspaces", key: ["id"], columns: [t("id"), t("user_id"), t("job_id"), t("bot_id"), t("page_key"), t("status"), t("url"), t("title"), t("takeover_job_id"), ts("updated_at"), ts("created_at")] },
  { table: "mcp_connections", key: ["id"], columns: [t("id"), t("user_id"), t("name"), t("url"), t("transport"), t("auth_secret"), j("headers"), b("enabled"), ts("last_test_at"), t("last_error"), ts("created_at"), ts("updated_at")] },
  { table: "job_artifacts", key: ["id"], columns: [t("id"), t("user_id"), t("job_id"), t("thread_id"), t("bot_id"), t("path"), t("title"), t("mime_type"), t("description"), ts("created_at"), ts("updated_at")] },
  { table: "app_notifications", key: ["id"], columns: [t("id"), t("user_id"), t("job_id"), t("kind"), t("title"), t("body"), ts("read_at"), ts("created_at")] },
];

const PAGE = 500;
const BATCH_STATEMENTS = 50;
// D1 limits a single string/blob/row to 2 MB; stay well under it.
const MAX_ROW_BYTES = 1_800_000;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const reset = args.has("--reset");

const sourceUrl = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
const proxyUrl = process.env.D1_PROXY_URL;
const proxyToken = process.env.D1_PROXY_TOKEN;
if (!sourceUrl) throw new Error("SOURCE_DATABASE_URL (the Postgres to copy from) is required");
if (!proxyUrl || !proxyToken) throw new Error("D1_PROXY_URL and D1_PROXY_TOKEN are required");
if (reset && !args.has("--yes")) throw new Error("--reset deletes every row in D1. Pass --yes to confirm.");

const pg = postgres(sourceUrl, { prepare: false, max: 1 });
const d1 = remoteExecutor(proxyUrl, proxyToken);
const q = (name: string) => `"${name.replaceAll('"', '""')}"`;

function selectList(columns: Column[]) {
  return columns
    .map(([name, kind]) => {
      if (kind === "ts") return `(extract(epoch from ${q(name)}) * 1000)::bigint::text as ${q(name)}`;
      if (kind === "json") return `${q(name)}::text as ${q(name)}`;
      if (kind === "int") return `${q(name)}::text as ${q(name)}`;
      return q(name);
    })
    .join(", ");
}

function toD1(value: unknown, kind: Kind): unknown {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case "bool":
      return value ? 1 : 0;
    case "int":
    case "ts":
      return Number(value);
    default:
      return value;
  }
}

/** Key-order-independent JSON for comparing jsonb with what D1 stored. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [c]) => (a < c ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function upsertSql(spec: TableSpec) {
  const names = spec.columns.map(([name]) => q(name));
  const updates = spec.columns
    .map(([name]) => name)
    .filter((name) => !spec.key.includes(name))
    .map((name) => `${q(name)} = excluded.${q(name)}`);
  return (
    `INSERT INTO ${q(spec.table)} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})` +
    ` ON CONFLICT (${spec.key.map(q).join(", ")}) DO ${updates.length ? `UPDATE SET ${updates.join(", ")}` : "NOTHING"}`
  );
}

async function d1Count(table: string) {
  const result = await d1.query({ sql: `select count(*) from ${q(table)}`, params: [], method: "get" });
  return Number((result.rows as unknown[])[0]);
}

async function copyTable(spec: TableSpec) {
  const sql = upsertSql(spec);
  const order = spec.key.map(q).join(", ");
  let copied = 0;
  let largest = 0;
  let pending: { sql: string; params: unknown[]; method: "run" }[] = [];

  const flush = async () => {
    if (!pending.length || dryRun) {
      pending = [];
      return;
    }
    await d1.batch(pending);
    pending = [];
  };

  for (let offset = 0; ; offset += PAGE) {
    const rows = await pg.unsafe(
      `select ${selectList(spec.columns)} from ${q(spec.table)} order by ${order} limit ${PAGE} offset ${offset}`,
    );
    if (!rows.length) break;
    for (const row of rows) {
      const params = spec.columns.map(([name, kind]) => toD1(row[name], kind));
      const bytes = params.reduce<number>((sum, value) => sum + (typeof value === "string" ? Buffer.byteLength(value) : 8), 0);
      largest = Math.max(largest, bytes);
      if (bytes > MAX_ROW_BYTES) {
        throw new Error(`${spec.table} row ${JSON.stringify(spec.key.map((k) => row[k]))} is ${bytes} bytes; D1 rejects rows over 2 MB. Trim it in Postgres first.`);
      }
      pending.push({ sql, params, method: "run" });
      copied += 1;
      if (pending.length >= BATCH_STATEMENTS) await flush();
    }
    if (rows.length < PAGE) break;
  }
  await flush();
  console.log(`  ${spec.table.padEnd(20)} ${String(copied).padStart(7)} rows   largest row ${largest} bytes`);
  return copied;
}

async function verify(spec: TableSpec, expected: number) {
  if (dryRun) return;
  const actual = await d1Count(spec.table);
  if (actual !== expected) throw new Error(`${spec.table}: Postgres has ${expected} rows, D1 has ${actual}`);
  const jsonColumns = spec.columns.filter(([, kind]) => kind === "json").map(([name]) => name);
  if (!jsonColumns.length || spec.table === "job_events") return;
  const order = spec.key.map(q).join(", ");
  const cols = [...spec.key, ...jsonColumns];
  for (let offset = 0; ; offset += PAGE) {
    const [source, target] = await Promise.all([
      pg.unsafe(`select ${cols.map((c) => `${q(c)}::text as ${q(c)}`).join(", ")} from ${q(spec.table)} order by ${order} limit ${PAGE} offset ${offset}`),
      d1.query({ sql: `select ${cols.map(q).join(", ")} from ${q(spec.table)} order by ${order} limit ${PAGE} offset ${offset}`, params: [], method: "all" }),
    ]);
    const rows = target.rows as unknown[][];
    if (source.length !== rows.length) throw new Error(`${spec.table}: page at ${offset} differs in length`);
    source.forEach((row, index) => {
      for (const [c, name] of cols.entries()) {
        const a = spec.key.includes(name) ? row[name] : canonical(JSON.parse(row[name]));
        const bValue = spec.key.includes(name) ? rows[index]![c] : canonical(JSON.parse(String(rows[index]![c])));
        if (a !== bValue) throw new Error(`${spec.table}.${name} differs for ${JSON.stringify(spec.key.map((k) => row[k]))}`);
      }
    });
    if (source.length < PAGE) break;
  }
}

async function main() {
  console.log(`${dryRun ? "DRY RUN: " : ""}copying Postgres -> D1 via ${proxyUrl}`);
  if (reset && !dryRun) {
    for (const spec of [...TABLES].reverse()) {
      await d1.query({ sql: `delete from ${q(spec.table)}`, params: [], method: "run" });
    }
    console.log("  target tables emptied");
  }
  const counts = new Map<string, number>();
  for (const spec of TABLES) counts.set(spec.table, await copyTable(spec));
  for (const spec of TABLES) await verify(spec, counts.get(spec.table)!);
  console.log(dryRun ? "Dry run finished; nothing was written." : "Copy finished and verified (row counts and JSON documents match).");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pg.end({ timeout: 5 }));
