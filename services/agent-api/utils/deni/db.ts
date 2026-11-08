import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

let pool: Pool | null = null;

export type DeniDb = NodePgDatabase;

const databases = new WeakMap<Pool, DeniDb>();

function getPositiveIntEnv(envKey: string, fallback: number): number {
  const rawValue = process.env[envKey];
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
}

function normalizeConnectionString(connectionString: string): string {
  const url = new URL(connectionString);

  // We set TLS behavior explicitly via the `ssl` pool option below.
  // Removing legacy sslmode values here avoids pg's deprecation warning and
  // keeps future parser changes from altering our runtime behavior.
  url.searchParams.delete('sslmode');

  return url.toString();
}

/**
 * Get or create a PostgreSQL connection pool for Deni AI database
 */
export function getDeniPool(): Pool {
  pool ??= createPool();
  return pool;
}

/**
 * Drizzle over the same pool. Tables: `@deniai/db/flixa` (Flixa's own) and
 * `@deniai/db` (Deni AI's `public` schema).
 */
export function getDeniDb(): DeniDb {
  const client = getDeniPool();
  let db = databases.get(client);
  if (!db) {
    db = drizzle({ client });
    databases.set(client, db);
  }
  return db;
}

function createPool(): Pool {
  const connectionString = process.env.DENI_DATABASE_URL;
  const disableTlsVerification = process.env.DENI_DATABASE_SSL_NO_VERIFY === 'true';
  // For plaintext endpoints such as a local Postgres or an SSH tunnel.
  const disableTls = process.env.DENI_DATABASE_SSL_DISABLED === 'true';
  if (!connectionString) {
    throw new Error('DENI_DATABASE_URL environment variable is not set');
  }

  return new Pool({
    connectionString: normalizeConnectionString(connectionString),
    ssl: disableTls
      ? false
      : disableTlsVerification
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true },
    max: getPositiveIntEnv('DENI_DATABASE_POOL_MAX', 10),
    idleTimeoutMillis: getPositiveIntEnv('DENI_DATABASE_IDLE_TIMEOUT_MS', 30000),
    connectionTimeoutMillis: getPositiveIntEnv('DENI_DATABASE_CONNECTION_TIMEOUT_MS', 5000),
    query_timeout: getPositiveIntEnv('DENI_DATABASE_QUERY_TIMEOUT_MS', 5000),
    statement_timeout: getPositiveIntEnv('DENI_DATABASE_STATEMENT_TIMEOUT_MS', 5000),
  });
}

/**
 * Close the Deni database pool (for graceful shutdown)
 */
export async function closeDeniPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
