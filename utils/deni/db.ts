import { Pool } from 'pg';

let pool: Pool | null = null;

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
  if (!pool) {
    const connectionString = Bun.env.DENI_DATABASE_URL;
    const disableTlsVerification = Bun.env.DENI_DATABASE_SSL_NO_VERIFY === 'true';
    if (!connectionString) {
      throw new Error('DENI_DATABASE_URL environment variable is not set');
    }

    pool = new Pool({
      connectionString: normalizeConnectionString(connectionString),
      ssl: disableTlsVerification ? { rejectUnauthorized: false } : { rejectUnauthorized: true },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
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
