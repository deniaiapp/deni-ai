/**
 * Copy the files stored in UploadThing to Cloudflare R2, under the same keys.
 * Rows keep their `storage_key`, so the database is only read, never written,
 * and nothing is deleted from either store. Covers ready attachments and
 * ready, unexpired data exports whose key is not an R2 key yet
 * (`attachments/<id>`, `exports/<id>`); files being deleted are skipped.
 *
 * Dry run by default: lists what is left to copy (a file already in R2 is
 * not copied again). `--apply` copies. Rerun after deploying the R2 build to
 * pick up files uploaded to UploadThing in between, until a dry run reports
 * nothing left (see SETUP.md, "Attachment storage", for the rollout order).
 *
 * Needs DATABASE_URL, UPLOADTHING_TOKEN and the R2_* settings.
 */
import { and, eq, gt, isNotNull, notLike } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../src/db/schema";
import { createFileStorage, storageConfigFrom } from "../src/lib/stored-files";
import { downloadUploadThingFile, parseUploadThingToken } from "./uploadthing-api";

const databaseUrl = process.env.DATABASE_URL;
const uploadThing = parseUploadThingToken(process.env.UPLOADTHING_TOKEN);
const storageConfig = storageConfigFrom(process.env);
if (!databaseUrl || !uploadThing || !storageConfig) {
  console.error(
    "DATABASE_URL, a valid UPLOADTHING_TOKEN and R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET are required.",
  );
  process.exit(1);
}

const apply = process.argv.slice(2).includes("--apply");
const CONCURRENCY = 4;

const db = drizzle({ connection: { url: databaseUrl, max: 1, prepare: false }, schema });
const storage = createFileStorage(storageConfig);
const { attachment, accountExport } = schema;

type StoredFile = { key: string; mediaType: string; disposition: "inline" | "attachment" };

const files: StoredFile[] = [
  ...(
    await db
      .select({ key: attachment.storageKey, mediaType: attachment.mediaType })
      .from(attachment)
      .where(
        and(
          eq(attachment.status, "ready"),
          isNotNull(attachment.storageKey),
          notLike(attachment.storageKey, "attachments/%"),
        ),
      )
  ).map(({ key, mediaType }) => ({ key: key!, mediaType, disposition: "inline" as const })),
  ...(
    await db
      .select({ key: accountExport.storageKey })
      .from(accountExport)
      .where(
        and(
          eq(accountExport.status, "ready"),
          gt(accountExport.expiresAt, new Date()),
          isNotNull(accountExport.storageKey),
          notLike(accountExport.storageKey, "exports/%"),
        ),
      )
  ).map(({ key }) => ({
    key: key!,
    mediaType: "application/json",
    disposition: "attachment" as const,
  })),
];

/** Copy one file. Returns its size, `null` when it already is in R2. */
async function copy({ key, mediaType, disposition }: StoredFile): Promise<number | null> {
  if (await storage.exists(key)) return null;
  if (!apply) return 0;
  const { body, contentType, contentDisposition } = await downloadUploadThingFile(
    uploadThing!,
    key,
  );
  // Keep the name and type UploadThing served the file with.
  await storage.put(key, body, {
    contentType: contentType || mediaType,
    contentDisposition: contentDisposition || disposition,
  });
  return body.byteLength;
}

let copied = 0;
let copiedBytes = 0;
let present = 0;
const failed: string[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
    while (next < files.length) {
      const file = files[next++]!;
      try {
        const size = await copy(file);
        if (size === null) {
          present++;
        } else {
          copied++;
          copiedBytes += size;
        }
      } catch (error) {
        failed.push(file.key);
        console.error(`Failed to copy ${file.key}:`, error);
      }
    }
  }),
);

const MiB = 1024 * 1024;
console.log(`UploadThing files recorded in the database: ${files.length}`);
console.log(`Already in R2: ${present}`);
console.log(
  apply
    ? `Copied to R2: ${copied} (${(copiedBytes / MiB).toFixed(1)} MiB)`
    : `Left to copy: ${copied} (dry run; rerun with --apply to copy them)`,
);
if (failed.length > 0) {
  console.error(`Failed (${failed.length}): ${failed.join(", ")}`);
  process.exit(1);
}
process.exit(0);
