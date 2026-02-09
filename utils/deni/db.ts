import { Pool } from 'pg';

let pool: Pool | null = null;

/**
 * Get or create a PostgreSQL connection pool for Deni AI database
 */
export function getDeniPool(): Pool {
  if (!pool) {
    const connectionString = Bun.env.DENI_DATABASE_URL;
    if (!connectionString) {
      throw new Error('DENI_DATABASE_URL environment variable is not set');
    }

    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
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
