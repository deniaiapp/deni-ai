import { neon } from "@neondatabase/serverless";
import { and, eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../src/db/schema";
import {
  attachmentStorageKey,
  createFileStorage,
  exportStorageKey,
  storageConfigFrom,
} from "../src/lib/stored-files";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(databaseUrl);
const db = drizzle(sql, { schema });

const RETENTION_DAYS = 7;
const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
const purged = and(eq(schema.user.isAnonymous, true), lt(schema.user.createdAt, cutoff));

// Deleting a user cascades its attachment and data export rows, the only record
// of its stored files: read them first, and delete the files once the users are gone.
// A row without a key may still have a file under the key its id derives.
const keys = [
  ...(
    await db
      .select({ id: schema.attachment.id, storageKey: schema.attachment.storageKey })
      .from(schema.attachment)
      .innerJoin(schema.user, eq(schema.attachment.userId, schema.user.id))
      .where(purged)
  ).map(({ id, storageKey }) => storageKey ?? attachmentStorageKey(id)),
  ...(
    await db
      .select({ id: schema.accountExport.id, storageKey: schema.accountExport.storageKey })
      .from(schema.accountExport)
      .innerJoin(schema.user, eq(schema.accountExport.userId, schema.user.id))
      .where(purged)
  ).map(({ id, storageKey }) => storageKey ?? exportStorageKey(id)),
];

// Checked before any user is deleted: once the rows are gone, nothing records
// these files, so a run that cannot delete them must not delete the users.
const storageConfig = storageConfigFrom(process.env);
if (keys.length > 0 && !storageConfig) {
  console.error(
    `R2 storage (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET) is not configured: the guests to purge have ${keys.length} stored file(s). No users were deleted.`,
  );
  process.exit(1);
}

const result = await db.delete(schema.user).where(purged);

console.log(
  `Deleted ${result.rowCount ?? 0} anonymous user(s) created before ${cutoff.toISOString()}`,
);

if (keys.length > 0 && storageConfig) {
  const deleted = new Set(await createFileStorage(storageConfig).delete(keys));
  console.log(`Deleted ${deleted.size} stored file(s) of the deleted users.`);
  // The rows are gone: list what is left so it can be deleted by hand.
  const left = keys.filter((key) => !deleted.has(key));
  if (left.length > 0) {
    console.error(`Not deleted (storage keys): ${left.join(", ")}`);
    process.exit(1);
  }
}
process.exit(0);
