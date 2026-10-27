import { localExecutor } from "../db/local-executor";

// The local executor applies every file in db/migrations in order, so opening an
// in-memory database is itself the migration test. Then check the resulting shape.
async function main() {
  const db = localExecutor(":memory:");
  const names = async (type: string) =>
    ((await db.query({
      sql: "select name from sqlite_master where type = ? and name not like 'sqlite_%' and name != '__local_migrations' order by name",
      params: [type],
      method: "all",
    })).rows as [string][]).map((row) => row[0]);

  const tables = await names("table");
  const expected = [
    "account",
    "agent_jobs",
    "app_notifications",
    "auth_rate_limit",
    "browser_workspaces",
    "discord_link_codes",
    "discord_links",
    "job_artifacts",
    "job_events",
    "mcp_connections",
    "mcp_explanations",
    "passkey",
    "rate_limits",
    "session",
    "thread_messages",
    "two_factor",
    "user",
    "user_stores",
    "verification",
  ];
  if (JSON.stringify(tables) !== JSON.stringify(expected)) {
    throw new Error(`Migration schema mismatch: ${tables.join(", ")}`);
  }

  const indexes = await names("index");
  for (const required of [
    "user_stores_stripe_customer_idx",
    "agent_jobs_user_idempotency_uidx",
    "job_events_user_job_sequence_uidx",
    "discord_links_discord_user_uidx",
    "passkey_credentialID_uidx",
  ]) {
    if (!indexes.includes(required)) throw new Error(`Missing index ${required}`);
  }

  // The same guard the D1 proxy applies: no interactive transactions.
  let refused = false;
  try {
    await db.query({ sql: "begin", params: [], method: "run" });
  } catch {
    refused = true;
  }
  if (!refused) throw new Error("BEGIN must be refused");
  console.log(`verified migrations ${expected.length} tables, ${indexes.length} indexes on SQLite`);
}

void main();
