import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { DeniDb } from "../../utils/deni/db";

/**
 * Isolated PostgreSQL/WASM database with Deni AI's `user` table (the target of
 * Flixa's foreign keys) and Flixa's migrations applied. No external DB.
 */
export async function createFlixaTestDb(): Promise<{ pglite: PGlite; db: DeniDb }> {
  const pglite = new PGlite();
  await pglite.exec(`CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '')`);
  await migrateFlixa(pglite);
  // Same query builder as node-postgres; only the driver differs.
  return { pglite, db: drizzle({ client: pglite }) as unknown as DeniDb };
}

export async function migrateFlixa(pglite: PGlite): Promise<void> {
  await migrate(drizzle({ client: pglite }), {
    migrationsFolder: fileURLToPath(new URL("../../migrations", import.meta.url)),
    migrationsSchema: "flixa",
    migrationsTable: "__drizzle_migrations",
  });
}
