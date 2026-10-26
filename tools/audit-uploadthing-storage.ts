/**
 * Read-only audit of the UploadThing app before deleting its files: lists every
 * file UploadThing holds and says what in the database still points at it, so
 * the gap between UploadThing's usage and what was copied to R2 is accounted for.
 *
 * Each file falls in the first category that applies: an `attachment` row (by
 * status), an `account_export` row, a public URL in saved chats or model
 * comparisons (uploads from before storage became private that never got an
 * attachment row), a retired project file, a profile image, or nothing at all.
 * With the R2_* settings set, files the R2 copy tool covers are also checked
 * in R2. Nothing is written to the database, UploadThing or R2.
 *
 * `--csv=<path>` also writes one line per file with its category.
 *
 * Needs DATABASE_URL and UPLOADTHING_TOKEN; the R2_* settings are optional.
 */
import { writeFileSync } from "node:fs";
import { and, asc, gt, isNotNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../src/db/schema";
import { createFileStorage, storageConfigFrom } from "../src/lib/stored-files";
import { mentionsUploadThing, uploadThingKeysInText } from "./legacy-uploadthing-urls";
import { listUploadThingFiles, parseUploadThingToken } from "./uploadthing-api";

const databaseUrl = process.env.DATABASE_URL;
const uploadThing = parseUploadThingToken(process.env.UPLOADTHING_TOKEN);
if (!databaseUrl || !uploadThing) {
  console.error("DATABASE_URL and a valid UPLOADTHING_TOKEN are required.");
  process.exit(1);
}

const csvArg = process.argv.slice(2).find((arg) => arg.startsWith("--csv="));
const csvPath = csvArg?.slice("--csv=".length);
if (csvArg && !csvPath) {
  console.error("--csv needs a file path, for example --csv=uploadthing-audit.csv");
  process.exit(1);
}

const CHAT_PAGE_SIZE = 200;
const R2_CHECK_CONCURRENCY = 8;

const storageConfig = storageConfigFrom(process.env);
const storage = storageConfig ? createFileStorage(storageConfig) : null;
const db = drizzle({ connection: { url: databaseUrl, max: 1, prepare: false }, schema });
const { attachment, accountExport, chats, modelComparisons, projectFiles, user } = schema;

/** Keys found in the text of every row of a table that mentions an UploadThing URL, read in pages by id. */
async function scanForKeys(
  read: (after: string) => Promise<{ id: string; text: string | null }[]>,
): Promise<Set<string>> {
  const keys = new Set<string>();
  let after = "";
  for (;;) {
    const rows = await read(after);
    for (const row of rows) for (const key of uploadThingKeysInText(row.text)) keys.add(key);
    if (rows.length < CHAT_PAGE_SIZE) return keys;
    after = rows.at(-1)!.id;
  }
}

console.log("Listing UploadThing files...");
const files = await listUploadThingFiles(uploadThing);

console.log("Reading database references...");
const attachmentStatus = new Map(
  (
    await db
      .select({ key: attachment.storageKey, status: attachment.status })
      .from(attachment)
      .where(isNotNull(attachment.storageKey))
  ).map(({ key, status }) => [key!, status]),
);
const now = new Date();
const exportIsCurrent = new Map(
  (
    await db
      .select({
        key: accountExport.storageKey,
        status: accountExport.status,
        expiresAt: accountExport.expiresAt,
      })
      .from(accountExport)
      .where(isNotNull(accountExport.storageKey))
  ).map(({ key, status, expiresAt }) => [
    key!,
    status === "ready" && expiresAt !== null && expiresAt > now,
  ]),
);

const chatText = sql`${chats.messages}::text`;
const chatKeys = await scanForKeys((after) =>
  db
    .select({ id: chats.id, text: sql<string | null>`${chatText}` })
    .from(chats)
    .where(and(gt(chats.id, after), mentionsUploadThing(chatText)))
    .orderBy(asc(chats.id))
    .limit(CHAT_PAGE_SIZE),
);
const comparisonText = sql`${modelComparisons.leftMessages}::text || ${modelComparisons.rightMessages}::text`;
const comparisonKeys = await scanForKeys((after) =>
  db
    .select({ id: modelComparisons.id, text: sql<string | null>`${comparisonText}` })
    .from(modelComparisons)
    .where(and(gt(modelComparisons.id, after), mentionsUploadThing(comparisonText)))
    .orderBy(asc(modelComparisons.id))
    .limit(CHAT_PAGE_SIZE),
);
const projectFileKeys = new Set(
  (await db.select({ url: projectFiles.url }).from(projectFiles)).flatMap(({ url }) =>
    uploadThingKeysInText(url),
  ),
);
const imageKeys = new Set(
  (
    await db
      .select({ image: user.image })
      .from(user)
      .where(mentionsUploadThing(sql`${user.image}`))
  ).flatMap(({ image }) => uploadThingKeysInText(image)),
);

const CATEGORIES = {
  "copy-target": "Ready attachment or current data export (copied by the R2 tool)",
  "attachment-pending": "Attachment still pending (interrupted upload)",
  "attachment-deleting": "Attachment marked for deletion",
  "export-stale": "Expired, failed or pending data export",
  "chat-public-url": "Public URL in a saved chat, no attachment row (not copied)",
  "comparison-public-url": "Public URL in a saved model comparison only (not copied)",
  "project-file": "Retired project file only (not copied)",
  "user-image": "Profile image only (not copied)",
  unreferenced: "Not referenced by the database",
} as const;
type Category = keyof typeof CATEGORIES;

function categoryOf(key: string): Category {
  const status = attachmentStatus.get(key);
  if (status === "ready") return "copy-target";
  if (status === "pending") return "attachment-pending";
  if (status === "deleting") return "attachment-deleting";
  const current = exportIsCurrent.get(key);
  if (current !== undefined) return current ? "copy-target" : "export-stale";
  if (chatKeys.has(key)) return "chat-public-url";
  if (comparisonKeys.has(key)) return "comparison-public-url";
  if (projectFileKeys.has(key)) return "project-file";
  if (imageKeys.has(key)) return "user-image";
  return "unreferenced";
}

const categorized = files.map((file) => ({ ...file, category: categoryOf(file.key) }));

/** Whether each copy target is in R2; empty without R2 settings. */
const inR2 = new Map<string, boolean>();
if (storage) {
  console.log("Checking copy targets in R2...");
  const targets = categorized.filter((file) => file.category === "copy-target");
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(R2_CHECK_CONCURRENCY, targets.length) }, async () => {
      while (next < targets.length) {
        const { key } = targets[next++]!;
        inR2.set(key, await storage.exists(key));
      }
    }),
  );
}

type Tally = { count: number; bytes: number };
function tally<T>(items: readonly T[], group: (item: T) => string, size: (item: T) => number) {
  const totals = new Map<string, Tally>();
  for (const item of items) {
    const entry = totals.get(group(item)) ?? { count: 0, bytes: 0 };
    entry.count++;
    entry.bytes += size(item);
    totals.set(group(item), entry);
  }
  return totals;
}

const MiB = 1024 * 1024;
const totalBytes = categorized.reduce((sum, file) => sum + file.size, 0);
function formatTally({ count, bytes }: Tally): string {
  const share = totalBytes > 0 ? ((bytes / totalBytes) * 100).toFixed(1) : "0.0";
  return `${String(count).padStart(7)} files ${(bytes / MiB).toFixed(1).padStart(10)} MiB ${share.padStart(5)}%`;
}

console.log(`\nUploadThing files: ${formatTally({ count: files.length, bytes: totalBytes })}`);

console.log("\nBy UploadThing status:");
for (const [status, total] of tally(
  categorized,
  (file) => file.status,
  (file) => file.size,
)) {
  console.log(`  ${status.padEnd(18)} ${formatTally(total)}`);
}

console.log("\nBy database reference:");
const byCategory = tally(
  categorized,
  (file) => file.category,
  (file) => file.size,
);
for (const category of Object.keys(CATEGORIES) as Category[]) {
  const total = byCategory.get(category);
  if (total) console.log(`  ${CATEGORIES[category].padEnd(66)} ${formatTally(total)}`);
}

if (storage) {
  const targets = categorized.filter((file) => file.category === "copy-target");
  const missing = targets.filter((file) => !inR2.get(file.key));
  console.log(
    `\nCopy targets in R2: ${targets.length - missing.length} of ${targets.length}` +
      (missing.length > 0
        ? ` (${formatTally(
            tally(
              missing,
              () => "",
              (file) => file.size,
            ).get("")!,
          ).trim()} still to copy: run tools:migrate-uploadthing-to-r2 --apply)`
        : ""),
  );
} else {
  console.log("\nR2 not checked (R2_* settings not set).");
}

const listedKeys = new Set(files.map((file) => file.key));
const missingTargets = [
  ...[...attachmentStatus].filter(([, status]) => status === "ready").map(([key]) => key),
  ...[...exportIsCurrent].filter(([, current]) => current).map(([key]) => key),
].filter(
  (key) => !key.startsWith("attachments/") && !key.startsWith("exports/") && !listedKeys.has(key),
);
if (missingTargets.length > 0) {
  console.log(
    `Ready UploadThing keys in the database that UploadThing does not list: ${missingTargets.length} (in R2 already, or lost)`,
  );
}

const notCopied = categorized.filter(
  (file) => file.category !== "copy-target" && file.category !== "export-stale",
);
if (notCopied.length > 0) {
  console.log("\nNot copied, by upload month:");
  const byMonth = tally(
    notCopied,
    (file) =>
      file.uploadedAt > 0 ? new Date(file.uploadedAt).toISOString().slice(0, 7) : "unknown",
    (file) => file.size,
  );
  for (const month of [...byMonth.keys()].sort()) {
    console.log(`  ${month.padEnd(8)} ${formatTally(byMonth.get(month)!)}`);
  }
}

if (csvPath) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const lines = categorized.map((file) =>
    [
      quote(file.key),
      quote(file.name),
      file.size,
      quote(file.status),
      file.uploadedAt > 0 ? new Date(file.uploadedAt).toISOString() : "",
      file.category,
      file.category === "copy-target" && storage ? String(inR2.get(file.key) ?? false) : "",
    ].join(","),
  );
  writeFileSync(
    csvPath,
    ["key,name,size,status,uploaded_at,category,in_r2", ...lines].join("\n") + "\n",
  );
  console.log(`\nWrote ${categorized.length} rows to ${csvPath}`);
}

process.exit(0);
