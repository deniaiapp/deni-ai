import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * Any Drizzle Postgres database: postgres.js (web), node-postgres (agent API) or
 * PGlite (tests). The engine only uses the query builder, `execute` and
 * `transaction`, and passes `@deniai/db` tables explicitly, so the schema
 * generic does not matter.
 */
// oxlint-disable-next-line no-explicit-any
export type UsageEngineDatabase = PgDatabase<PgQueryResultHKT, any, any>;

/** A database or an open transaction, for reads and writes inside the usage lock. */
export type UsageQueryDatabase = Pick<UsageEngineDatabase, "select" | "insert" | "update">;

export type UsageEngineLogger = Pick<Console, "error" | "warn">;
