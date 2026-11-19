import { defineConfig } from "drizzle-kit";

// Flixa (services/agent-api) shares the Deni AI database but only manages its
// own `flixa` schema; the tables in `public` are migrated with drizzle.config.ts.
// Run from packages/db: `pnpm run db:generate:flixa` / `db:migrate:flixa`
// (the agent API's `db:generate` / `db:migrate` scripts forward here).
export default defineConfig({
  schema: "./src/flixa/schema.ts",
  out: "./flixa-migrations",
  dialect: "postgresql",
  schemaFilter: ["flixa"],
  migrations: { schema: "flixa", table: "__drizzle_migrations" },
  dbCredentials: {
    url: process.env.DENI_DATABASE_URL ?? "",
  },
});
