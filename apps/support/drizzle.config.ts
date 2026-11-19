import { defineConfig } from 'drizzle-kit';

/**
 * The help center shares the Deni AI database but only manages its own `support`
 * schema; Deni AI's tables in `public` and Flixa's in `flixa` are migrated by
 * their own projects.
 *
 * drizzle-kit connects directly, not through Neon's pooler (`-pooler` host):
 * migrations need a session.
 */
function migrationUrl(value: string | undefined) {
  if (!value) return '';
  const url = new URL(value);
  url.hostname = url.hostname.replace(/-pooler\./, '.');
  url.searchParams.set('options', '-c client_min_messages=warning');
  return url.toString();
}

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  schemaFilter: ['support'],
  migrations: { schema: 'support', table: '__drizzle_migrations' },
  dbCredentials: {
    url: migrationUrl(process.env.DATABASE_URL),
  },
});
