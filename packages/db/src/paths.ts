import { fileURLToPath } from "node:url";

/** Absolute path of the `public` schema migrations (drizzle.config.ts). */
export const publicMigrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Absolute path of the `flixa` schema migrations (drizzle.flixa.config.ts),
 * recorded in `flixa.__drizzle_migrations`.
 */
export const flixaMigrationsFolder = fileURLToPath(new URL("../flixa-migrations", import.meta.url));
