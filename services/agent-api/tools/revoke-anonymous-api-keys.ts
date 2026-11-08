import { closeDeniPool, getDeniPool } from '../utils/deni';

const SCRIPT_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  const pool = getDeniPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    await client.query(`SET LOCAL statement_timeout = '25s'`);

    const result = await client.query(
      `DELETE FROM api_key
       WHERE user_id IN (
         SELECT id FROM "user" WHERE is_anonymous = true
       )`
    );

    await client.query('COMMIT');
    console.log(`Revoked ${result.rowCount ?? 0} anonymous API key(s).`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const timeout = setTimeout(() => {
  console.error(`Timed out after ${SCRIPT_TIMEOUT_MS}ms while revoking anonymous API keys.`);
  process.exit(1);
}, SCRIPT_TIMEOUT_MS);

try {
  await main();
} catch (error) {
  console.error('Failed to revoke anonymous API keys:', error);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await closeDeniPool();
}
