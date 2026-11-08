import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/env";

import * as schema from "@/db/schema";

/**
 * Long-lived Docker / Dokploy process: TCP pool via postgres.js.
 * Idle connections stay open: the database can be a region away (Neon in
 * Singapore, the app in Japan), where opening one costs about a second.
 * postgres.js still recycles each connection after 30-60 minutes.
 * Date values in raw `sql` fragments must be ISO strings (`::timestamptz`);
 * postgres.js cannot serialize a Date instance (unlike neon-http).
 * `prepare: false` stays compatible with Neon's PgBouncer pooler URL.
 */
export const db = drizzle({
  connection: {
    url: env.DATABASE_URL,
    max: 8,
    idle_timeout: 0,
    connect_timeout: 10,
    prepare: false,
  },
  schema,
});
