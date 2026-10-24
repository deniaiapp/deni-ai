import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit connects directly, not through Neon's pooler (`-pooler` host):
 * migrations need a session, and PgBouncer ignores session settings such as
 * `client_min_messages`, which hides the NOTICEs of drizzle's idempotent
 * `CREATE ... IF NOT EXISTS` statements.
 */
function migrationUrl(value: string | undefined) {
  if (!value) return "";
  const url = new URL(value);
  url.hostname = url.hostname.replace(/-pooler\./, ".");
  url.searchParams.set("options", "-c client_min_messages=warning");
  return url.toString();
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: migrationUrl(process.env.DATABASE_URL),
  },
});
