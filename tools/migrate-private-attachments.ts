/**
 * One-off migration of attachments uploaded before storage became private.
 * Their chats reference public UploadThing URLs (`https://<appId>.ufs.sh/f/<key>`)
 * in the saved messages. For each such file this records an `attachment` row
 * (owner: the chat's owner, tied to the chat, size from UploadThing), rewrites
 * the URLs in the chat's messages to the app URL `/api/attachments/<id>`, and
 * makes the file private. Nothing is deleted.
 *
 * Dry run by default; pass `--apply` to write, and `--limit=<n>` to migrate at
 * most n chats per run. Resumable: a rerun finds only what is left. Each chat
 * is migrated in one transaction holding its row lock; its files become
 * private just before that commits, so a failure leaves the chat as it was.
 *
 * A file referenced by chats of more than one account (for example through an
 * imported transcript), or already recorded for another account, is left
 * public and listed for manual review. One referenced by several chats of one
 * account is tied to the first; deleting that chat keeps it for the others
 * (`markChatAttachmentsForDeletion` ties it to one of them).
 *
 * Needs DATABASE_URL and UPLOADTHING_TOKEN. Run once the private-storage
 * release is deployed (see SETUP.md, "Attachment storage").
 */
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { nanoid } from "nanoid";
import { UTApi } from "uploadthing/server";

import * as schema from "../src/db/schema";
import {
  findLegacyAttachments,
  rewriteLegacyAttachmentUrls,
} from "../src/lib/legacy-attachment-migration";
import { STORAGE_BATCH_SIZE, uploadThingFileHostname } from "../src/lib/stored-files";

const databaseUrl = process.env.DATABASE_URL;
const token = process.env.UPLOADTHING_TOKEN;
const hostname = uploadThingFileHostname(token);
if (!databaseUrl || !token || !hostname) {
  console.error("DATABASE_URL and a valid UPLOADTHING_TOKEN are required.");
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
const LIST_PAGE_SIZE = 500;

const db = drizzle({ connection: { url: databaseUrl, max: 1, prepare: false }, schema });
const utapi = new UTApi({ token });
const { attachment, chats } = schema;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }
  return result;
}

/** Sizes of every stored file by key, or `null` when UploadThing cannot list them. */
async function listFileSizes(): Promise<Map<string, number> | null> {
  const sizes = new Map<string, number>();
  try {
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const { files, hasMore } = await utapi.listFiles({ limit: LIST_PAGE_SIZE, offset });
      for (const file of files) sizes.set(file.key, file.size);
      if (!hasMore || files.length === 0) return sizes;
    }
  } catch (error) {
    console.warn("Could not list UploadThing files; sizes will be recorded as 0.", error);
    return null;
  }
}

// 1. Scan every chat whose saved messages mention this app's storage host.
type Candidate = { chatId: string; userId: string };
const candidates: Candidate[] = [];
const owners = new Map<string, Set<string>>();
let ownerlessChats = 0;
for (let after = ""; ;) {
  const page = await db
    .select({ id: chats.id, uid: chats.uid, messages: chats.messages })
    .from(chats)
    .where(and(gt(chats.id, after), sql`${chats.messages}::text like ${`%${hostname}/f/%`}`))
    .orderBy(asc(chats.id))
    .limit(PAGE_SIZE);
  if (page.length === 0) break;
  for (const chat of page) {
    const keys = findLegacyAttachments(chat.messages, hostname);
    if (keys.size === 0) continue;
    if (!chat.uid) {
      ownerlessChats++;
      continue;
    }
    candidates.push({ chatId: chat.id, userId: chat.uid });
    for (const key of keys.keys()) owners.set(key, (owners.get(key) ?? new Set()).add(chat.uid));
  }
  after = page.at(-1)!.id;
}

// 2. Files already recorded: reusable by their own owner, a conflict for anyone else.
const recordedOwner = new Map<string, string>();
for (const batch of chunks([...owners.keys()], 500)) {
  const rows = await db
    .select({ storageKey: attachment.storageKey, userId: attachment.userId })
    .from(attachment)
    .where(inArray(attachment.storageKey, batch));
  for (const row of rows) if (row.storageKey) recordedOwner.set(row.storageKey, row.userId);
}
const conflicts = new Set(
  [...owners].flatMap(([key, users]) => {
    const recorded = recordedOwner.get(key);
    return users.size > 1 || (recorded !== undefined && !users.has(recorded)) ? [key] : [];
  }),
);

const sizes = await listFileSizes();
const bytesByUser = new Map<string, number>();
let totalBytes = 0;
let missing = 0;
for (const [key, users] of owners) {
  if (conflicts.has(key) || recordedOwner.has(key)) continue;
  const size = sizes?.get(key);
  if (sizes && size === undefined) missing++;
  totalBytes += size ?? 0;
  const [user] = users;
  if (user) bytesByUser.set(user, (bytesByUser.get(user) ?? 0) + (size ?? 0));
}

const MiB = 1024 * 1024;
console.log(
  [
    `Chats with public attachment URLs: ${candidates.length}${ownerlessChats ? ` (+${ownerlessChats} without an owner, skipped)` : ""}`,
    `Files: ${owners.size} (${recordedOwner.size} already recorded, ${conflicts.size} left public for review)`,
    sizes
      ? `New storage counted against quotas: ${(totalBytes / MiB).toFixed(1)} MiB across ${bytesByUser.size} account(s)${missing ? `; ${missing} file(s) not found in UploadThing (recorded as 0 bytes)` : ""}`
      : "New storage counted against quotas: unknown (UploadThing listing failed; sizes recorded as 0)",
  ].join("\n"),
);
const largest = [...bytesByUser].toSorted((a, b) => b[1] - a[1]).slice(0, 10);
if (largest.length > 0) {
  console.log("Largest per-account additions (compare with the plan quotas in SETUP.md):");
  for (const [user, bytes] of largest) console.log(`  ${user}: ${(bytes / MiB).toFixed(1)} MiB`);
}
if (conflicts.size > 0) {
  console.log(`Left public (referenced by several accounts): ${[...conflicts].join(", ")}`);
}

if (!apply) {
  console.log("[dry run] Nothing was changed. Pass --apply to migrate.");
  process.exit(0);
}

// 3. Migrate chat by chat.
let migratedChats = 0;
let rewrittenParts = 0;
let failedChats = 0;
for (const candidate of candidates) {
  if (migratedChats >= limit) break;
  try {
    const rewritten = await db.transaction(async (tx) => {
      // Locked, so a save of this chat cannot land between this read and the
      // write below and be lost. A save can still follow the commit with the
      // old URLs, from a tab loaded before this run: the chat route rewrites
      // the user's migrated URLs to their app URLs before saving, and a rerun
      // of this tool rewrites any that remain.
      const [chat] = await tx
        .select({ uid: chats.uid, messages: chats.messages })
        .from(chats)
        .where(eq(chats.id, candidate.chatId))
        .for("update");
      if (!chat || chat.uid !== candidate.userId) return 0;
      const found = [...findLegacyAttachments(chat.messages, hostname)].filter(
        ([key]) => !conflicts.has(key),
      );
      if (found.length === 0) return 0;

      await tx
        .insert(attachment)
        .values(
          found.map(([key, mediaType]) => ({
            id: nanoid(32),
            userId: candidate.userId,
            chatId: candidate.chatId,
            storageKey: key,
            mediaType,
            sizeBytes: sizes?.get(key) ?? 0,
            status: "ready" as const,
          })),
        )
        .onConflictDoNothing({ target: attachment.storageKey });
      const rows = await tx
        .select({ id: attachment.id, userId: attachment.userId, storageKey: attachment.storageKey })
        .from(attachment)
        .where(
          inArray(
            attachment.storageKey,
            found.map(([key]) => key),
          ),
        );
      // Recorded for someone else since the scan: left as is.
      const own = rows.filter((row) => row.userId === candidate.userId && row.storageKey);
      if (own.length === 0) return 0;
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
      const result = rewriteLegacyAttachmentUrls(chat.messages, hostname, idsByKey);
      if (result.rewritten === 0) return 0;
      // Last, so a failure here rolls everything back and the file stays public.
      for (const batch of chunks([...idsByKey.keys()], STORAGE_BATCH_SIZE)) {
        const { success } = await utapi.updateACL(batch, "private");
        if (!success) throw new Error("UploadThing did not update the file ACL");
      }
      // `updated_at` is kept: the migration must not reorder the chat list.
      await tx
        .update(chats)
        .set({ messages: result.messages })
        .where(eq(chats.id, candidate.chatId));
      return result.rewritten;
    });
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
if (migratedChats >= limit && candidates.length > migratedChats) {
  console.log("Stopped at --limit; rerun to continue.");
}
process.exit(failedChats > 0 ? 1 : 0);
