import { neon } from "@neondatabase/serverless";
import { and, eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { UTApi } from "uploadthing/server";

import * as schema from "../src/db/schema";
import { deleteFilesInBatches, uploadThingFileHostname } from "../src/lib/stored-files";

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
const files = [
  ...(await db
    .select({ id: schema.attachment.id, storageKey: schema.attachment.storageKey })
    .from(schema.attachment)
    .innerJoin(schema.user, eq(schema.attachment.userId, schema.user.id))
    .where(purged)),
  ...(await db
    .select({ id: schema.accountExport.id, storageKey: schema.accountExport.storageKey })
    .from(schema.accountExport)
    .innerJoin(schema.user, eq(schema.accountExport.userId, schema.user.id))
    .where(purged)),
];

// Checked before any user is deleted: once the rows are gone, nothing records
// these files, so a run that cannot delete them must not delete the users.
const token = process.env.UPLOADTHING_TOKEN;
if (files.length > 0 && !uploadThingFileHostname(token)) {
  console.error(
    `UPLOADTHING_TOKEN is not set or invalid: the guests to purge have ${files.length} stored file(s). No users were deleted.`,
  );
  process.exit(1);
}

const result = await db.delete(schema.user).where(purged);

console.log(
  `Deleted ${result.rowCount ?? 0} anonymous user(s) created before ${cutoff.toISOString()}`,
);

if (files.length > 0) {
  const utapi = new UTApi({ token });
  // A key is recorded once the upload finished; before that, the file can only
  // be found by its custom id (the attachment or export id).
  const keys = files.flatMap(({ storageKey }) => (storageKey ? [storageKey] : []));
  const customIds = files.flatMap(({ id, storageKey }) => (storageKey ? [] : [id]));
  const deletedKeys = new Set(await deleteFilesInBatches(utapi, keys, "fileKey"));
  const deletedIds = new Set(await deleteFilesInBatches(utapi, customIds, "customId"));
  console.log(`Deleted ${deletedKeys.size + deletedIds.size} stored file(s) of the deleted users.`);
  // The rows are gone: list what is left so it can be deleted by hand.
  const leftKeys = keys.filter((key) => !deletedKeys.has(key));
  const leftIds = customIds.filter((id) => !deletedIds.has(id));
  if (leftKeys.length > 0) console.error(`Not deleted (file keys): ${leftKeys.join(", ")}`);
  if (leftIds.length > 0) console.error(`Not deleted (custom ids): ${leftIds.join(", ")}`);
  if (leftKeys.length > 0 || leftIds.length > 0) process.exit(1);
}
process.exit(0);
