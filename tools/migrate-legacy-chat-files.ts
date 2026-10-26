/**
 * Move files uploaded before storage became private to R2. Saved chats still
 * reference them by public UploadThing URLs (`https://<appId>.ufs.sh/f/<key>`,
 * `https://utfs.io/f/<key>`) in file parts, with no `attachment` row, so the
 * R2 copy tool (`migrate-uploadthing-to-r2.ts`) never saw them. For each such
 * file this copies it to R2 under its UploadThing key (like the copy tool),
 * records a ready `attachment` row (owner: the chat's owner, tied to the
 * chat, size from UploadThing), and rewrites the URLs in the chat's messages
 * to the app URL `/api/attachments/<id>`. Nothing is deleted from UploadThing.
 *
 * Dry run by default: reports what would be migrated and how much storage each
 * account gains against its quota. `--apply` migrates; `--limit=<n>` migrates
 * at most n chats per run. Resumable: a rerun finds only what is left, and
 * also rewrites URLs a tab loaded before the run saved back.
 *
 * A file referenced by chats of more than one account (for example through an
 * imported transcript), or already recorded for another account, is left as
 * it is and listed for manual review. One referenced by several chats of one
 * account is tied to the first and its row reused for the others. A file
 * UploadThing no longer lists is left as it is and counted. Ownerless chats
 * are skipped. URLs outside file parts (for example pasted into a message's
 * text) are not rewritten; they are only counted.
 *
 * Each chat is rewritten in one transaction holding its row lock, after its
 * files are in R2, so a failure leaves the chat as it was (a file copied for
 * it stays in R2 and is not copied again on the rerun).
 *
 * Needs DATABASE_URL, UPLOADTHING_TOKEN and the R2_* settings.
 */
import { and, asc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { nanoid } from "nanoid";

import * as schema from "../src/db/schema";
import { createFileStorage, storageConfigFrom } from "../src/lib/stored-files";
import {
  findLegacyFiles,
  mentionsUploadThing,
  rewriteLegacyFileUrls,
  uploadThingKeysInText,
} from "./legacy-uploadthing-urls";
import {
  downloadUploadThingFile,
  listUploadThingFiles,
  parseUploadThingToken,
  type UploadThingFile,
} from "./uploadthing-api";

const databaseUrl = process.env.DATABASE_URL;
const uploadThing = parseUploadThingToken(process.env.UPLOADTHING_TOKEN);
const storageConfig = storageConfigFrom(process.env);
if (!databaseUrl || !uploadThing || !storageConfig) {
  console.error(
    "DATABASE_URL, a valid UPLOADTHING_TOKEN and R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET are required.",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;
if (!(limit > 0) || (limit !== Infinity && !Number.isInteger(limit))) {
  console.error(`Invalid --limit value: ${limitArg}`);
  process.exit(1);
}

const PAGE_SIZE = 100;
const COPY_CONCURRENCY = 4;
const MiB = 1024 * 1024;

const db = drizzle({ connection: { url: databaseUrl, max: 1, prepare: false }, schema });
const storage = createFileStorage(storageConfig);
const { attachment, chats } = schema;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }
  return result;
}

async function forEachConcurrently<T>(items: readonly T[], run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(COPY_CONCURRENCY, items.length) }, async () => {
      while (next < items.length) await run(items[next++]!);
    }),
  );
}

console.log("Listing UploadThing files...");
const listed = new Map<string, UploadThingFile>(
  (await listUploadThingFiles(uploadThing)).map((file) => [file.key, file]),
);

// 1. Scan every chat whose saved messages mention an UploadThing file host.
console.log("Scanning chats...");
type Candidate = { chatId: string; userId: string; keys: string[] };
const candidates: Candidate[] = [];
const owners = new Map<string, Set<string>>();
const mediaTypes = new Map<string, string>();
const outsideFileParts = new Set<string>();
let ownerlessChats = 0;
const chatText = sql`${chats.messages}::text`;
for (let after = ""; ;) {
  const page = await db
    .select({ id: chats.id, uid: chats.uid, text: sql<string>`${chatText}` })
    .from(chats)
    .where(and(gt(chats.id, after), mentionsUploadThing(chatText)))
    .orderBy(asc(chats.id))
    .limit(PAGE_SIZE);
  if (page.length === 0) break;
  for (const chat of page) {
    const found = findLegacyFiles(JSON.parse(chat.text), uploadThing.appId);
    for (const key of uploadThingKeysInText(chat.text)) {
      if (!found.has(key) && listed.has(key)) outsideFileParts.add(key);
    }
    if (found.size === 0) continue;
    if (!chat.uid) {
      ownerlessChats++;
      continue;
    }
    candidates.push({ chatId: chat.id, userId: chat.uid, keys: [...found.keys()] });
    for (const [key, mediaType] of found) {
      owners.set(key, (owners.get(key) ?? new Set()).add(chat.uid));
      if (!mediaTypes.has(key)) mediaTypes.set(key, mediaType);
    }
  }
  after = page.at(-1)!.id;
}
for (const key of owners.keys()) outsideFileParts.delete(key);

// 2. Files already recorded: reusable by their own owner while ready, a
// conflict for anyone else, and left alone while pending or being deleted.
const recorded = new Map<string, { userId: string; status: string }>();
for (const batch of chunks([...owners.keys()], 500)) {
  const rows = await db
    .select({ key: attachment.storageKey, userId: attachment.userId, status: attachment.status })
    .from(attachment)
    .where(and(isNotNull(attachment.storageKey), inArray(attachment.storageKey, batch)));
  for (const row of rows) recorded.set(row.key!, { userId: row.userId, status: row.status });
}

const conflicts = new Set<string>();
const missing = new Set<string>();
const unavailable = new Set<string>();
/** Keys to migrate: in UploadThing, one owner, new or that owner's ready row. */
const eligible = new Set<string>();
const bytesByUser = new Map<string, number>();
let newFiles = 0;
let newBytes = 0;
for (const [key, users] of owners) {
  const row = recorded.get(key);
  const [owner] = users;
  if (users.size > 1 || (row && !users.has(row.userId))) conflicts.add(key);
  else if (row && row.status !== "ready") unavailable.add(key);
  else if (!listed.has(key)) missing.add(key);
  else {
    eligible.add(key);
    if (!row) {
      const size = listed.get(key)!.size;
      newFiles++;
      newBytes += size;
      bytesByUser.set(owner!, (bytesByUser.get(owner!) ?? 0) + size);
    }
  }
}

console.log(
  [
    `Chats with public UploadThing file URLs: ${candidates.length}${ownerlessChats ? ` (+${ownerlessChats} without an owner, skipped)` : ""}`,
    `Files referenced: ${owners.size}`,
    `  to migrate: ${eligible.size} (${newFiles} new, ${(newBytes / MiB).toFixed(1)} MiB counted against the quotas of ${bytesByUser.size} account(s); ${eligible.size - newFiles} already recorded)`,
    `  referenced by several accounts or recorded for another (left for review): ${conflicts.size}`,
    `  recorded but pending or being deleted (left as they are): ${unavailable.size}`,
    `  not in UploadThing any more (left as they are): ${missing.size}`,
    `Files only mentioned outside file parts (not rewritten): ${outsideFileParts.size}`,
  ].join("\n"),
);
const largest = [...bytesByUser].toSorted((a, b) => b[1] - a[1]).slice(0, 10);
if (largest.length > 0) {
  console.log("Largest per-account additions (compare with the plan quotas in SETUP.md):");
  for (const [user, bytes] of largest) console.log(`  ${user}: ${(bytes / MiB).toFixed(1)} MiB`);
}
if (conflicts.size > 0) console.log(`Left for review: ${[...conflicts].join(", ")}`);

if (!apply) {
  console.log("[dry run] Nothing was changed. Pass --apply to migrate.");
  process.exit(0);
}

// 3. Copy the files of the chats this run migrates to R2.
const selected = candidates.slice(0, limit);
const toCopy = new Set(selected.flatMap(({ keys }) => keys.filter((key) => eligible.has(key))));
const copied = new Set<string>();
const contentTypes = new Map<string, string>();
const copyFailed: string[] = [];
let copiedBytes = 0;
console.log(`Copying up to ${toCopy.size} file(s) to R2...`);
await forEachConcurrently([...toCopy], async (key) => {
  try {
    if (!(await storage.exists(key))) {
      const { body, contentType, contentDisposition } = await downloadUploadThingFile(
        uploadThing,
        key,
      );
      await storage.put(key, body, {
        contentType: contentType || mediaTypes.get(key) || "application/octet-stream",
        contentDisposition: contentDisposition || "inline",
      });
      copiedBytes += body.byteLength;
      if (contentType) contentTypes.set(key, contentType.split(";")[0]!.trim());
    }
    copied.add(key);
  } catch (error) {
    copyFailed.push(key);
    console.error(`Failed to copy ${key}:`, error);
  }
});
console.log(`Copied ${(copiedBytes / MiB).toFixed(1)} MiB (files already in R2 were skipped).`);

/** The media type a row records: the file part's, or what UploadThing served. */
function mediaTypeOf(key: string): string {
  const fromPart = mediaTypes.get(key);
  return fromPart && fromPart !== "application/octet-stream"
    ? fromPart
    : (contentTypes.get(key) ?? fromPart ?? "application/octet-stream");
}

// 4. Record and rewrite chat by chat.
let migratedChats = 0;
let rewrittenParts = 0;
let failedChats = 0;
const skippedSinceScan = new Set<string>();
for (const candidate of selected) {
  try {
    const { rewritten, skipped } = await db.transaction(async (tx) => {
      // Locked, so a save of this chat cannot land between this read and the
      // write below and be lost. A tab loaded before this run can still save
      // the old URLs back after the commit; a rerun rewrites them.
      const [chat] = await tx
        .select({ uid: chats.uid, messages: chats.messages })
        .from(chats)
        .where(eq(chats.id, candidate.chatId))
        .for("update");
      const none = { rewritten: 0, skipped: [] as string[] };
      if (!chat || chat.uid !== candidate.userId) return none;
      const found = [...findLegacyFiles(chat.messages, uploadThing.appId).keys()].filter(
        (key) => eligible.has(key) && copied.has(key),
      );
      if (found.length === 0) return none;

      // A key another chat of this run recorded first conflicts and is reused.
      const unrecorded = found.filter((key) => !recorded.has(key));
      if (unrecorded.length > 0) {
        await tx
          .insert(attachment)
          .values(
            unrecorded.map((key) => {
              const file = listed.get(key)!;
              return {
                id: nanoid(32),
                userId: candidate.userId,
                chatId: candidate.chatId,
                storageKey: key,
                mediaType: mediaTypeOf(key),
                sizeBytes: file.size,
                status: "ready" as const,
                ...(file.uploadedAt > 0 ? { createdAt: new Date(file.uploadedAt) } : {}),
              };
            }),
          )
          .onConflictDoNothing({ target: attachment.storageKey });
      }
      // Only the owner's ready rows: a file recorded for someone else, or
      // deleted or marked for deletion, since the scan is left as it is.
      const own = await tx
        .select({ id: attachment.id, storageKey: attachment.storageKey })
        .from(attachment)
        .where(
          and(
            inArray(attachment.storageKey, found),
            eq(attachment.userId, candidate.userId),
            eq(attachment.status, "ready"),
          ),
        );
      const ownKeys = new Set(own.map((row) => row.storageKey));
      const skipped = found.filter((key) => !ownKeys.has(key));
      if (own.length === 0) return { ...none, skipped };
      // A reused row no longer tied to a chat would expire; tie it to this one.
      await tx
        .update(attachment)
        .set({ chatId: candidate.chatId })
        .where(
          and(
            inArray(
              attachment.id,
              own.map((row) => row.id),
            ),
            isNull(attachment.chatId),
          ),
        );

      const idsByKey = new Map(own.map((row) => [row.storageKey!, row.id]));
      const result = rewriteLegacyFileUrls(chat.messages, uploadThing.appId, idsByKey);
      if (result.rewritten === 0) return { ...none, skipped };
      // `updated_at` is kept: the migration must not reorder the chat list.
      await tx
        .update(chats)
        .set({ messages: result.messages })
        .where(eq(chats.id, candidate.chatId));
      return { rewritten: result.rewritten, skipped };
    });
    for (const key of skipped) skippedSinceScan.add(key);
    if (rewritten > 0) {
      migratedChats++;
      rewrittenParts += rewritten;
    }
  } catch (error) {
    failedChats++;
    console.error(`Failed to migrate chat ${candidate.chatId}:`, error);
  }
}

console.log(
  `Migrated ${migratedChats} chat(s), ${rewrittenParts} file part(s).${failedChats ? ` ${failedChats} chat(s) failed; rerun to retry.` : ""}`,
);
if (copyFailed.length > 0) {
  console.log(
    `Failed to copy (their chats keep the old URLs; rerun to retry): ${copyFailed.join(", ")}`,
  );
}
if (skippedSinceScan.size > 0) {
  console.log(
    `Recorded for another account, or deleted or being deleted, since the scan (chats left as they are): ${[...skippedSinceScan].join(", ")}`,
  );
}
if (selected.length < candidates.length) console.log("Stopped at --limit; rerun to continue.");
process.exit(failedChats > 0 || copyFailed.length > 0 ? 1 : 0);
