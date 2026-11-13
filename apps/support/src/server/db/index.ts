import { drizzle } from 'drizzle-orm/postgres-js';
import { serverEnv } from '../env';
import * as schema from './schema';

function createDb(url: string) {
  // Long-lived Node process, like deni-ai: a small postgres.js pool that keeps idle
  // connections open. `prepare: false` stays compatible with Neon's pooler URL.
  return drizzle({
    connection: { url, max: 4, idle_timeout: 0, connect_timeout: 10, prepare: false },
    schema,
  });
}

let db: ReturnType<typeof createDb> | undefined;

/** The database; only call when {@link serverEnv.databaseUrl} is set. */
export function getDb() {
  const url = serverEnv.databaseUrl;
  if (!url) throw new Error('DATABASE_URL is not set.');
  db ??= createDb(url);
  return db;
}
