/**
 * Copy a whole Postgres database (every schema, including drizzle's migration
 * history) to an empty one, then compare exact row counts table by table.
 *
 *   pnpm exec tsx tools/copy-database.ts --env=.env.canary           # dry run
 *   pnpm exec tsx tools/copy-database.ts --env=.env.canary --apply   # copy
 *
 * The env file supplies DATABASE_URL (source) and TARGET_DATABASE_URL (target).
 * A Neon pooler URL is switched to its direct host: pg_dump needs a session.
 * pg_dump / pg_restore run in the `postgres:<major>` Docker image matching the
 * source server, so Docker must be running; credentials reach the container as
 * environment variables, never as command-line arguments.
 *
 * The source must not receive writes during the copy (stop the app first),
 * or the row counts will not match. The dump is kept in the OS temp directory
 * as a backup; it contains user data, so delete it once the move is settled.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import postgres from "postgres";

const args = process.argv.slice(2);
const envFile = args.find((arg) => arg.startsWith("--env="))?.slice("--env=".length);
const apply = args.includes("--apply");

if (!envFile) {
  console.error("Usage: tsx tools/copy-database.ts --env=<file> [--apply]");
  process.exit(1);
}

const env = parseEnv(readFileSync(envFile, "utf8"));

function connectionUrl(name: string) {
  const value = env[name];
  if (!value) {
    console.error(`${name} is not set in ${envFile}`);
    process.exit(1);
  }
  const url = new URL(value);
  url.hostname = url.hostname.replace(/-pooler\./, ".");
  return url.toString();
}

const sourceUrl = connectionUrl("DATABASE_URL");
const targetUrl = connectionUrl("TARGET_DATABASE_URL");
if (new URL(sourceUrl).host === new URL(targetUrl).host) {
  console.error("DATABASE_URL and TARGET_DATABASE_URL point at the same server.");
  process.exit(1);
}

const label = (url: string) => new URL(url).host;

/** Inside the container, localhost (e.g. an SSH tunnel) is the Docker host. */
function containerUrl(value: string) {
  const url = new URL(value);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    url.hostname = "host.docker.internal";
  }
  return url.toString();
}
const connect = (url: string) => postgres(url, { max: 1, prepare: false, onnotice: () => {} });

type TableCount = { table: string; rows: number };

/** Exact row counts of every table outside the system schemas. */
async function tableCounts(sql: postgres.Sql): Promise<TableCount[]> {
  const tables = await sql<{ schema: string; name: string }[]>`
    select table_schema as schema, table_name as name
    from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema not in ('pg_catalog', 'information_schema')
      and table_schema not like 'pg_%'
    order by 1, 2`;
  const counts: TableCount[] = [];
  for (const { schema, name } of tables) {
    const [row] = await sql<{ rows: number }[]>`
      select count(*)::int as rows from ${sql(schema)}.${sql(name)}`;
    counts.push({ table: `${schema}.${name}`, rows: row?.rows ?? 0 });
  }
  return counts;
}

async function serverMajor(sql: postgres.Sql) {
  const [row] = await sql<{ server_version_num: string }[]>`show server_version_num`;
  return Math.floor(Number(row?.server_version_num) / 10_000);
}

const source = connect(sourceUrl);
const target = connect(targetUrl);

try {
  const [sourceMajor, targetMajor, sourceCounts, targetCounts] = await Promise.all([
    serverMajor(source),
    serverMajor(target),
    tableCounts(source),
    tableCounts(target),
  ]);
  const sourceRows = sourceCounts.reduce((sum, entry) => sum + entry.rows, 0);
  console.log(`Source ${label(sourceUrl)}: Postgres ${sourceMajor}`);
  console.log(`  ${sourceCounts.length} tables, ${sourceRows} rows`);
  console.log(`Target ${label(targetUrl)}: Postgres ${targetMajor}`);
  console.log(`  ${targetCounts.length} tables`);

  // Never restore over existing data: the copy is for an empty database only.
  if (targetCounts.length > 0) {
    console.error("The target already has tables. Use an empty database.");
    process.exit(1);
  }
  if (targetMajor < sourceMajor) {
    console.error(`The target runs an older Postgres (${targetMajor} < ${sourceMajor}).`);
    process.exit(1);
  }

  if (!apply) {
    console.log("Dry run: nothing copied. Pass --apply to copy.");
    process.exit(0);
  }

  const dumpDir = mkdtempSync(path.join(tmpdir(), "deni-ai-db-"));
  const image = `postgres:${sourceMajor}`;
  console.log(`Copying with ${image}; dump kept in ${dumpDir}`);
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-e",
      "SOURCE_URL",
      "-e",
      "TARGET_URL",
      "-v",
      `${dumpDir}:/dump`,
      image,
      "sh",
      "-c",
      [
        'pg_dump --format=custom --no-owner --no-acl --dbname="$SOURCE_URL" --file=/dump/database.dump',
        'pg_restore --no-owner --no-acl --exit-on-error --single-transaction --dbname="$TARGET_URL" /dump/database.dump',
      ].join(" && "),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        SOURCE_URL: containerUrl(sourceUrl),
        TARGET_URL: containerUrl(targetUrl),
      },
    },
  );
  if (result.status !== 0) {
    console.error("pg_dump / pg_restore failed; the target is left unchanged.");
    process.exit(1);
  }
  const dumpSize = statSync(path.join(dumpDir, "database.dump")).size;
  console.log(`Dump: ${(dumpSize / 1024 / 1024).toFixed(1)} MiB`);

  const [after, copied] = await Promise.all([tableCounts(source), tableCounts(target)]);
  const copiedRows = new Map(copied.map((entry) => [entry.table, entry.rows]));
  const mismatches = after.filter((entry) => copiedRows.get(entry.table) !== entry.rows);
  if (mismatches.length > 0 || copied.length !== after.length) {
    console.error("Row counts differ:");
    for (const entry of mismatches) {
      console.error(
        `  ${entry.table}: source ${entry.rows}, target ${copiedRows.get(entry.table)}`,
      );
    }
    if (copied.length !== after.length) {
      console.error(`  tables: source ${after.length}, target ${copied.length}`);
    }
    process.exit(1);
  }
  console.log(`Verified: ${after.length} tables with matching row counts.`);
} finally {
  await Promise.all([source.end(), target.end()]);
}
