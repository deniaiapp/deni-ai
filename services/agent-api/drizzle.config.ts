import { defineConfig } from "drizzle-kit";

// Flixa shares the Deni AI database but only manages its own `flixa` schema;
// Deni AI's tables in `public` are migrated by deni-ai.
export default defineConfig({
  schema: "./utils/deni/schema/flixa.ts",
  out: "./migrations",
  dialect: "postgresql",
  schemaFilter: ["flixa"],
  migrations: { schema: "flixa", table: "__drizzle_migrations" },
  dbCredentials: {
    url: process.env.DENI_DATABASE_URL ?? "",
  },
});
