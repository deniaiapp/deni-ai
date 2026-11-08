/**
 * Migrate the standalone Deni Run (Cloudflare D1 or its local SQLite file) into the
 * platform's run_* tables. See docs/run-migration.md.
 *
 *   pnpm --filter @deniai/run migrate:d1 -- --source <file.sqlite|export.sql> [options]
 *
 * Options:
 *   --source <path>                 Run's SQLite file or a `wrangler d1 export` .sql dump (read-only)
 *   --target-url <url>              Postgres URL (default: DATABASE_URL)
 *   --source-key-env-file <path>    env file holding Deni Run's APP_ENCRYPTION_KEY (or set
 *                                   RUN_SOURCE_ENCRYPTION_KEY); needed when secrets are encrypted
 *   --dry-run                       read and map everything, write nothing
 *   --verify                        compare source and target (counts + spot checks); exit 1 on mismatch
 *   --report <file>                 write the JSON report there
 *   --create-placeholder-users      (localhost only) create missing linked Deni AI users
 *   --rehearsal-link-unlinked       (localhost only) map unlinked Run users to run-rehearsal-* users
 *   --map <runUserId>=<deniUserId>  (localhost only, repeatable) explicit user mapping
 *   --i-know-this-is-production     allow a non-localhost target
 *
 * The target Run key is RUN_ENCRYPTION_KEY or the key derived from BETTER_AUTH_SECRET,
 * read from the environment (run with --env-file of the target app). Secrets are never printed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  MigrationGuardError,
  migrateRun,
  openSource,
  readSource,
  targetHost,
  verifyMigration,
  type MigrationReport,
  type VerifyReport,
} from "../src/migration";
import { runEncryptionKey, type RunDatabase } from "../src/runtime";

function readEnvFileValue(path: string, name: string) {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] !== name) continue;
    return match[2]!.replace(/^(['"])(.*)\1$/, "$2").trim() || null;
  }
  return null;
}

function sourceKey(envFile: string | undefined) {
  const encoded =
    (envFile ? readEnvFileValue(envFile, "APP_ENCRYPTION_KEY") : null) ??
    process.env.RUN_SOURCE_ENCRYPTION_KEY?.trim() ??
    null;
  if (!encoded) return null;
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("The source APP_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

function summarize(report: MigrationReport) {
  const lines = [
    report.dryRun ? "Deni Run migration (dry run: nothing written)" : "Deni Run migration",
  ];
  for (const item of report.users) {
    lines.push(
      `- ${item.runUserId} -> ${item.deniUserId ?? "(unlinked)"} [${item.link}] ${item.status}${
        item.placeholderCreated ? " (placeholder user)" : ""
      }${item.error ? `: ${item.error}` : ""}`,
    );
    if (item.ignoredFields.length)
      lines.push(`    ignored store fields: ${item.ignoredFields.join(", ")}`);
    for (const skipped of item.skipped)
      lines.push(`    skipped ${skipped.table} ${skipped.id}: ${skipped.reason}`);
  }
  lines.push("Rows (planned / new / already present):");
  for (const [table, value] of Object.entries(report.totals))
    lines.push(`  ${table.padEnd(26)} ${value.planned} / ${value.inserted} / ${value.existing}`);
  lines.push(`Unlinked Run users (not migrated): ${report.unlinkedUsers.join(", ") || "none"}`);
  lines.push(
    `Skipped in-flight jobs: ${
      report.skippedJobs.map((job) => `${job.id} (${job.status})`).join(", ") || "none"
    }`,
  );
  lines.push(`Re-encrypted secrets: ${report.reencryptedSecrets}`);
  lines.push(`Placeholder users: ${report.placeholderUsers.join(", ") || "none"}`);
  lines.push(
    `Not migrated: ${
      Object.entries(report.notMigrated)
        .map(([table, n]) => `${table} (${n})`)
        .join(", ") || "none"
    }`,
  );
  return lines.join("\n");
}

function summarizeVerify(report: VerifyReport) {
  const lines = [`Verify: ${report.ok ? "OK" : "MISMATCH"}`];
  for (const item of report.users) {
    const tables = Object.entries(item.counts)
      .filter(([, value]) => value.expected || value.found)
      .map(
        ([table, value]) =>
          `${table} ${value.expected}/${value.found}${value.missing ? ` (-${value.missing})` : ""}`,
      );
    lines.push(
      `- ${item.runUserId} -> ${item.deniUserId}: ${item.spotChecks} spot checks; ${tables.join(", ")}`,
    );
  }
  for (const mismatch of report.mismatches) lines.push(`  ! ${mismatch}`);
  return lines.join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: "string" },
      "target-url": { type: "string" },
      "source-key-env-file": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      verify: { type: "boolean", default: false },
      report: { type: "string" },
      "create-placeholder-users": { type: "boolean", default: false },
      "rehearsal-link-unlinked": { type: "boolean", default: false },
      map: { type: "string", multiple: true },
      "i-know-this-is-production": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  if (!values.source) throw new MigrationGuardError("--source is required");
  const targetUrl = values["target-url"] ?? process.env.DATABASE_URL;
  if (!targetUrl) throw new MigrationGuardError("--target-url or DATABASE_URL is required");
  const map: Record<string, string> = {};
  for (const entry of values.map ?? []) {
    const [runUserId, deniUserId] = entry.split("=");
    if (!runUserId || !deniUserId) throw new MigrationGuardError(`Invalid --map ${entry}`);
    map[runUserId] = deniUserId;
  }
  const common = {
    targetUrl,
    production: values["i-know-this-is-production"],
    rehearsalLinkUnlinked: values["rehearsal-link-unlinked"],
    map,
    keys: {
      source: sourceKey(values["source-key-env-file"]),
      target: runEncryptionKey(process.env),
    },
  };
  const source = readSource(openSource(values.source));
  const client = postgres(targetUrl, { max: 2, onnotice: () => undefined, prepare: false });
  const db = drizzle({ client }) as unknown as RunDatabase;
  console.info(
    `Source: ${values.source} (${source.users.length} Run users). Target host: ${targetHost(targetUrl)}`,
  );
  let ok = true;
  const output: { migration?: MigrationReport; verify?: VerifyReport } = {};
  try {
    if (!values.verify || values["dry-run"]) {
      output.migration = await migrateRun({
        ...common,
        source,
        db,
        dryRun: values["dry-run"],
        createPlaceholderUsers: values["create-placeholder-users"],
      });
      console.info(summarize(output.migration));
      ok &&= output.migration.ok;
    }
    if (values.verify) {
      output.verify = await verifyMigration({ ...common, source, db });
      console.info(summarizeVerify(output.verify));
      ok &&= output.verify.ok;
    }
  } finally {
    await client.end();
  }
  if (values.report) writeFileSync(values.report, `${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = error instanceof MigrationGuardError ? 2 : 1;
});
