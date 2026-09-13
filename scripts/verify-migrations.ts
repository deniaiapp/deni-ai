import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const client = postgres(databaseUrl, { prepare: false, max: 1 });
const schema = `deni_migration_test_${Date.now().toString(36)}`;
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

async function applyFile(path: string) {
  // The baseline migration names public.user explicitly; point that reference at
  // the isolated test schema so this also works against an empty database.
  const sql = (await readFile(path, "utf8")).replaceAll(
    '"public"."user"',
    `${quoteIdentifier(schema)}."user"`,
  );
  for (const statement of sql.split(/--> statement-breakpoint/)) {
    if (statement.trim()) await client.unsafe(statement);
  }
}

async function main() {
  await client.unsafe(`create schema ${quoteIdentifier(schema)}`);
  await client.unsafe(`set search_path to ${quoteIdentifier(schema)}`);
  await applyFile("db/migrations/0000_init.sql");
  await applyFile("db/migrations/0001_wakeful_king_cobra.sql");
  await applyFile("db/migrations/0002_funny_thundra.sql");
  const rows = (await client.unsafe(
    "select table_name from information_schema.tables where table_schema = $1 order by table_name",
    [schema],
  )) as Array<{ table_name: string }>;
  const expected = [
    "account",
    "agent_jobs",
    "app_notifications",
    "auth_rate_limit",
    "browser_workspaces",
    "job_artifacts",
    "job_events",
    "mcp_connections",
    "rate_limits",
    "session",
    "thread_messages",
    "two_factor",
    "user",
    "user_stores",
    "verification",
  ];
  const actual = rows.map((row) => row.table_name);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Migration schema mismatch: ${actual.join(", ")}`);
  }
  console.log(`verified 0000 -> 0002 in temporary schema ${schema}`);
}

async function run() {
  try {
    await main();
  } finally {
    await client.unsafe(`drop schema if exists ${quoteIdentifier(schema)} cascade`).catch(() => undefined);
    await client.end();
  }
}

void run();
