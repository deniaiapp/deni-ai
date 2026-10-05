import { defineConfig } from "drizzle-kit";

// Schema changes are generated here and applied with `wrangler d1 migrations apply`
// (production) or automatically by the local SQLite executor (development and tests).
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
});
