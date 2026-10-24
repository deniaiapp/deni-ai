import type { ModelMessage, UIMessage } from "ai";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db/drizzle";
import { attachment, chats } from "@/db/schema";
import { env } from "@/env";
import { collectAccountExportFiles } from "@/lib/account-export-jobs";
import { fitsStorageLimit, getStorageLimitBytes } from "@/lib/attachment-quota";
import { attachmentUrl, parseAppAttachmentUrl } from "@/lib/attachment-url";
import { attachmentStorageKey } from "@/lib/stored-files";
import {
  ATTACHMENT_FETCH_URL_TTL_SECONDS,
  deleteStoredFiles,
  isStorageConfigured,
  signAttachmentUrl,
} from "@/lib/upload";
import { getSubscriptionTier } from "@/lib/usage";

type AttachmentDatabase = Pick<typeof db, "select" | "update" | "delete" | "transaction">;

/**
 * A pending row reserves quota while its upload runs. One older than this
 * belongs to an upload that never finished (crash, timeout) and is dropped by
 * the storage-cleanup cron or the next time its owner uploads, so it cannot
 * hold quota forever.
 */
export const PENDING_ATTACHMENT_TTL_MS = 60 * 60_000;

/**
 * A stored file is tied to its chat when a message carrying it is saved, and
 * deleted with that chat. One still untied after this long was removed from
 * the composer, never sent, or lost its chat some other way (deleting a chat
 * unties its files); it is deleted by the storage-cleanup cron or the next
 * time its owner uploads.
 */
export const UNLINKED_ATTACHMENT_TTL_MS = 24 * 60 * 60_000;

/** Attachment ids resolved per chat request; older references read as unavailable. */
const MAX_RESOLVED_ATTACHMENTS = 100;

/** Rows the storage-cleanup cron marks, and deletes, per run. */
export const STORAGE_CLEANUP_BATCH_SIZE = 500;

/** Rows deleted per statement once their files are gone. */
const ROW_DELETE_BATCH_SIZE = 500;

/** 32 URL-safe characters: 192 random bits. */
export function newAttachmentId(): string {
  return nanoid(32);
}

/** Origin of absolute app URLs, or `null` (only relative ones are recognized) when unset. */
function appOrigin(): string | null {
  try {
    return new URL(env.NEXT_PUBLIC_BETTER_AUTH_URL).origin;
  } catch {
    return null;
  }
}

/** The attachment id of an app attachment URL: relative, or absolute on the app's own origin. */
export function attachmentIdFromUrl(url: string): string | null {
  return parseAppAttachmentUrl(url, appOrigin());
}

/** The storage quota of a user: guests have their own, others follow their plan tier. */
export async function getStorageLimitForUser(userId: string, isAnonymous: boolean) {
  return getStorageLimitBytes(isAnonymous ? "guest" : await getSubscriptionTier(userId));
}

function usedBytesQuery(database: Pick<typeof db, "select">, userId: string) {
  return database
    .select({ used: sql<number>`coalesce(sum(${attachment.sizeBytes}), 0)`.mapWith(Number) })
    .from(attachment)
    .where(
      and(
        eq(attachment.userId, userId),
        // Rows marked `deleting` gave their quota back when they were marked.
        inArray(attachment.status, ["pending", "ready"]),
      ),
    );
}

/** Bytes counted against the user's quota: stored files plus uploads in progress. */
export async function getStorageUsageBytes(
  userId: string,
  database: Pick<typeof db, "select"> = db,
): Promise<number> {
  const [row] = await usedBytesQuery(database, userId);
  return row?.used ?? 0;
}

export type StorageReservation =
  | { ok: true; id: string }
  | { ok: false; usedBytes: number; limitBytes: number };

/**
 * A row marked `deleting`. Its file is deleted by storage key, or by the key
 * every upload derives from its attachment id when the key was never recorded.
 */
export type DeletingAttachment = { id: string; storageKey: string | null };

const deletingColumns = { id: attachment.id, storageKey: attachment.storageKey };

/** Where a row's file is, or would be if its upload got that far. */
function attachmentFileKey({ id, storageKey }: DeletingAttachment): string {
  return storageKey ?? attachmentStorageKey(id);
}

/**
 * Delete the stored files of rows marked `deleting`, then the rows whose file
 * is gone. Call it once the transaction that marked them has committed. Never
 * throws: a row whose file (or row) could not be deleted stays marked, and the
 * storage-cleanup cron retries it. `failed` counts the rows left behind.
 */
export async function purgeDeletingAttachments(
  rows: readonly DeletingAttachment[],
  database: Pick<typeof db, "delete"> = db,
): Promise<{ deleted: number; failed: number }> {
  if (rows.length === 0) return { deleted: 0, failed: 0 };
  const gone = new Set(await deleteStoredFiles(rows.map(attachmentFileKey)));
  const removable = rows.flatMap((row) => (gone.has(attachmentFileKey(row)) ? [row.id] : []));

  let deleted = 0;
  for (let start = 0; start < removable.length; start += ROW_DELETE_BATCH_SIZE) {
    const ids = removable.slice(start, start + ROW_DELETE_BATCH_SIZE);
    try {
      await database
        .delete(attachment)
        .where(and(inArray(attachment.id, ids), eq(attachment.status, "deleting")));
      deleted += ids.length;
    } catch (error) {
      console.error("[attachments] Failed to delete attachment rows after their files", error);
    }
  }
  return { deleted, failed: rows.length - deleted };
}

/** Pending rows of uploads that never finished. */
function abandonedUploads(now: Date): SQL {
  return and(
    eq(attachment.status, "pending"),
    lt(attachment.createdAt, new Date(now.getTime() - PENDING_ATTACHMENT_TTL_MS)),
  )!;
}

/** Stored files not tied to any chat for too long. */
function untiedFiles(now: Date): SQL {
  return and(
    eq(attachment.status, "ready"),
    isNull(attachment.chatId),
    lt(attachment.createdAt, new Date(now.getTime() - UNLINKED_ATTACHMENT_TTL_MS)),
  )!;
}

/**
 * Reserve quota for an upload by inserting a pending row with its size. The
 * per-user advisory lock serializes concurrent uploads, so the usage read and
 * the insert cannot interleave and parallel uploads cannot pass the limit.
 * The owner's abandoned uploads and expired untied files are marked for
 * deletion first, so they never hold quota for long.
 */
export async function reserveAttachmentStorage(
  {
    userId,
    mediaType,
    sizeBytes,
    limitBytes,
    now = new Date(),
  }: {
    userId: string;
    mediaType: string;
    sizeBytes: number;
    limitBytes: number;
    now?: Date;
  },
  database: AttachmentDatabase = db,
): Promise<StorageReservation> {
  const { reservation, expired } = await database.transaction(
    async (tx): Promise<{ reservation: StorageReservation; expired: DeletingAttachment[] }> => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`attachment-storage:${userId}`}, 0))`,
      );
      const expired: DeletingAttachment[] = [];
      for (const condition of [abandonedUploads(now), untiedFiles(now)]) {
        expired.push(
          ...(await tx
            .update(attachment)
            .set({ status: "deleting" })
            .where(and(eq(attachment.userId, userId), condition))
            .returning(deletingColumns)),
        );
      }

      const [row] = await usedBytesQuery(tx, userId);
      const usedBytes = row?.used ?? 0;
      if (!fitsStorageLimit(usedBytes, sizeBytes, limitBytes)) {
        return { reservation: { ok: false, usedBytes, limitBytes }, expired };
      }
      const id = newAttachmentId();
      await tx.insert(attachment).values({ id, userId, mediaType, sizeBytes, status: "pending" });
      return { reservation: { ok: true, id }, expired };
    },
  );
  // Only once the marks are committed: a failure leaves them for the cron.
  await purgeDeletingAttachments(expired, database);
  return reservation;
}

/** Record the stored file. False when the reservation is gone (owner deleted meanwhile). */
export async function markAttachmentReady(
  id: string,
  storageKey: string,
  database: AttachmentDatabase = db,
): Promise<boolean> {
  const rows = await database
    .update(attachment)
    .set({ storageKey, status: "ready" })
    .where(and(eq(attachment.id, id), eq(attachment.status, "pending")))
    .returning({ id: attachment.id });
  return rows.length > 0;
}

/** Give back the quota of a failed upload whose file, if any, is deleted. */
export async function releaseAttachmentReservation(
  id: string,
  database: AttachmentDatabase = db,
): Promise<void> {
  await database
    .delete(attachment)
    .where(and(eq(attachment.id, id), eq(attachment.status, "pending")));
}

/**
 * Give back the quota of an upload that failed after its file may have been
 * stored, when deleting that file failed too. The reservation is the only
 * record of the file, so it is marked `deleting` instead of dropped: the
 * storage-cleanup cron deletes the file by the key derived from the
 * reservation id, then the row.
 */
export async function abandonAttachmentReservation(
  id: string,
  database: AttachmentDatabase = db,
): Promise<void> {
  await database
    .update(attachment)
    .set({ status: "deleting" })
    .where(and(eq(attachment.id, id), eq(attachment.status, "pending")));
}

/** Storage key of a stored attachment the user owns, or `null` (missing, someone else's, or pending). */
export async function findReadyAttachmentKey(
  id: string,
  userId: string,
  database: AttachmentDatabase = db,
): Promise<string | null> {
  const [row] = await database
    .select({ storageKey: attachment.storageKey })
    .from(attachment)
    .where(
      and(eq(attachment.id, id), eq(attachment.userId, userId), eq(attachment.status, "ready")),
    )
    .limit(1);
  return row?.storageKey ?? null;
}

type MessagePart = UIMessage["parts"][number];

/**
 * The attachment id of a file part that points at an app attachment URL.
 * Saved and imported messages are not validated: a malformed part has no id.
 */
function attachmentPartId(part: MessagePart): string | null {
  return (part.type === "file" || part.type === "reasoning-file") && typeof part.url === "string"
    ? attachmentIdFromUrl(part.url)
    : null;
}

/** Attachment ids referenced by app URLs in file parts, newest first, at most `limit`. */
function collectAttachmentIds(messages: UIMessage[], limit: number) {
  const ids = new Set<string>();
  let referenced = false;
  for (const message of messages.toReversed()) {
    for (const part of message.parts.toReversed()) {
      const id = attachmentPartId(part);
      if (!id) continue;
      referenced = true;
      if (ids.size < limit) ids.add(id);
    }
  }
  return { ids: [...ids], referenced };
}

/**
 * Tie the user's stored files referenced in a saved chat to that chat, so
 * deleting the chat deletes them and gives their quota back. A file already
 * tied to a chat keeps it. Best effort, never throws: an untied file is
 * retried on the chat's next request and otherwise expires as unsent.
 */
export async function linkChatAttachments(
  chatId: string,
  userId: string,
  messages: UIMessage[],
  database: AttachmentDatabase = db,
): Promise<void> {
  const { ids } = collectAttachmentIds(messages, MAX_RESOLVED_ATTACHMENTS);
  if (ids.length === 0) return;
  try {
    await database
      .update(attachment)
      .set({ chatId })
      .where(
        and(
          inArray(attachment.id, ids),
          eq(attachment.userId, userId),
          eq(attachment.status, "ready"),
          isNull(attachment.chatId),
        ),
      );
  } catch (error) {
    console.error("[attachments] Failed to link attachments to their chat", error);
  }
}

/**
 * The URLs a saved chat can reference each file by, mapped to its attachment
 * id: its app URL, relative or absolute on the app's origin.
 */
function attachmentReferenceUrls(files: readonly { id: string }[]): Map<string, string> {
  const origin = appOrigin();
  const ids = new Map<string, string>();
  for (const { id } of files) {
    ids.set(attachmentUrl(id), id);
    if (origin) ids.set(`${origin}${attachmentUrl(id)}`, id);
  }
  return ids;
}

/**
 * Tie each stored file of `chatId` that another chat of its owner still
 * references to the most recently updated of those chats, so deleting the
 * chat keeps it. `chats.messages` has no index to search: each of the owner's
 * other chats is read once, for the URLs of all of the chat's files together.
 */
async function keepFilesReferencedElsewhere(
  database: Pick<typeof db, "select" | "update">,
  userId: string,
  chatId: string,
): Promise<void> {
  const files = await database
    .select({ id: attachment.id })
    .from(attachment)
    .where(
      and(
        eq(attachment.userId, userId),
        eq(attachment.chatId, chatId),
        eq(attachment.status, "ready"),
      ),
    );
  if (files.length === 0) return;
  const idsByUrl = attachmentReferenceUrls(files);
  const url = sql<string>`refs.url #>> '{}'`;
  const references = await database
    .select({ chatId: chats.id, url })
    .from(chats)
    .crossJoinLateral(
      sql`jsonb_path_query(${chats.messages}, 'lax $[*].parts[*].url') as refs(url)`,
    )
    .where(and(eq(chats.uid, userId), ne(chats.id, chatId), inArray(url, [...idsByUrl.keys()])))
    .orderBy(desc(chats.updated_at));
  // Newest chat first: each file moves to the first chat listed for it.
  const keptBy = new Map<string, string[]>();
  const kept = new Set<string>();
  for (const reference of references) {
    const id = idsByUrl.get(reference.url);
    if (id === undefined || kept.has(id)) continue;
    kept.add(id);
    keptBy.set(reference.chatId, [...(keptBy.get(reference.chatId) ?? []), id]);
  }
  for (const [otherChatId, ids] of keptBy) {
    await database
      .update(attachment)
      .set({ chatId: otherChatId })
      .where(
        and(
          inArray(attachment.id, ids),
          eq(attachment.userId, userId),
          eq(attachment.chatId, chatId),
        ),
      );
  }
}

/**
 * Mark the attachments of the user's chats for deletion: of `chatId`, or of
 * every chat when omitted. They stop counting against the quota at once. Call
 * it in the transaction that deletes the chats, before deleting them (which
 * unties the rows: `chat_id` is `ON DELETE SET NULL`), and pass the result to
 * `purgeDeletingAttachments` once that transaction has committed.
 *
 * A file has one chat, but other chats of its owner can reference it too (a
 * re-imported export, a legacy file the private-storage migration found in
 * several chats). Deleting one chat keeps such a file and ties it to the most recently updated of those chats
 * instead.
 */
export async function markChatAttachmentsForDeletion(
  database: Pick<typeof db, "select" | "update">,
  userId: string,
  chatId?: string,
): Promise<DeletingAttachment[]> {
  if (chatId !== undefined) await keepFilesReferencedElsewhere(database, userId, chatId);
  return database
    .update(attachment)
    .set({ status: "deleting" })
    .where(
      and(
        eq(attachment.userId, userId),
        chatId === undefined ? isNotNull(attachment.chatId) : eq(attachment.chatId, chatId),
      ),
    )
    .returning(deletingColumns);
}

/**
 * One storage-cleanup run (`/api/cron/storage-cleanup`). Marks for deletion
 * uploads still pending after an hour and files untied from any chat for a
 * day, at most `limit` of each, oldest first. Then deletes the files and rows
 * of at most `limit` marked rows, including ones an earlier deletion (chat,
 * upload-time cleanup, earlier run) left behind. The next run continues.
 */
export async function cleanUpAttachmentStorage(
  {
    now = new Date(),
    limit = STORAGE_CLEANUP_BATCH_SIZE,
  }: {
    now?: Date;
    limit?: number;
  } = {},
  database: AttachmentDatabase = db,
): Promise<{ marked: number; deleted: number; failed: number }> {
  let marked = 0;
  for (const expired of [abandonedUploads(now), untiedFiles(now)]) {
    const candidates = await database
      .select({ id: attachment.id })
      .from(attachment)
      .where(expired)
      .orderBy(asc(attachment.createdAt))
      .limit(limit);
    if (candidates.length === 0) continue;
    // Checked again on write: an upload that finished, or a file sent in a
    // chat, since the read keeps its row.
    const rows = await database
      .update(attachment)
      .set({ status: "deleting" })
      .where(
        and(
          inArray(
            attachment.id,
            candidates.map(({ id }) => id),
          ),
          expired,
        ),
      )
      .returning({ id: attachment.id });
    marked += rows.length;
  }

  const deleting = await database
    .select(deletingColumns)
    .from(attachment)
    .where(eq(attachment.status, "deleting"))
    .orderBy(asc(attachment.createdAt))
    .limit(limit);
  const { deleted, failed } = await purgeDeletingAttachments(deleting, database);
  return { marked, deleted, failed };
}

/**
 * Every file an account has in storage, read before its user row is deleted
 * (that cascades the rows recording them): attachments and data export files.
 * Anything else stored per account belongs here too, so deleting the account
 * deletes it: add its keys to the result.
 */
export async function collectAccountStoredFiles(
  userId: string,
  database: Pick<typeof db, "select"> = db,
): Promise<string[]> {
  const [rows, exports] = await Promise.all([
    database.select(deletingColumns).from(attachment).where(eq(attachment.userId, userId)),
    collectAccountExportFiles(userId, database),
  ]);
  return [...rows.map(attachmentFileKey), ...exports];
}

/** Storage keys of users being deleted, read before their rows cascade away. */
const departingFiles = new Map<string, string[]>();

/**
 * Better Auth `databaseHooks.user.delete` steps for every account deletion
 * (Delete account, a guest removed after linking an account). Deleting the
 * user cascades its attachment and export rows, the only record of its files,
 * so their keys are read before and the files deleted once the user row is gone.
 * Neither step throws: storage cleanup must never block an account deletion.
 * A file whose deletion fails stays in storage with no row (logged).
 */
export const accountDeletionAttachmentHooks = {
  before: async (user: { id: string }) => {
    try {
      departingFiles.set(user.id, await collectAccountStoredFiles(user.id));
    } catch (error) {
      console.error("[attachments] Failed to read attachments before account deletion", error);
    }
  },
  after: async (user: { id: string }) => {
    const files = departingFiles.get(user.id);
    departingFiles.delete(user.id);
    if (files && files.length > 0) await deleteStoredFiles(files);
  },
};

/** Ids per lookup when checking imported attachment URLs. */
const IMPORT_LOOKUP_BATCH_SIZE = 1000;

/**
 * Settings → Import saves transcripts as they are, file parts included, and a
 * deni-ai export carries app attachment URLs, which only work for the account
 * that owns the file. One exported by another account of this deployment would
 * make every request of the imported chat fail (`ForeignAttachmentError`).
 * Replace each file part whose app attachment URL is not a file of the
 * importing user (someone else's, or deleted) with a text part, `notice` (the
 * caller localizes it: it is saved in the chat); `omitted` counts them. Other
 * URLs are kept as they were.
 */
export async function omitUnownedAttachmentParts<T extends { messages: UIMessage[] }>(
  conversations: T[],
  userId: string,
  notice: string,
  database: Pick<typeof db, "select"> = db,
): Promise<{ conversations: T[]; omitted: number }> {
  const ids = new Set<string>();
  for (const { messages } of conversations) {
    for (const message of messages) {
      for (const part of message.parts) {
        const id = attachmentPartId(part);
        if (id) ids.add(id);
      }
    }
  }
  if (ids.size === 0) return { conversations, omitted: 0 };

  const owned = new Set<string>();
  const requested = [...ids];
  for (let start = 0; start < requested.length; start += IMPORT_LOOKUP_BATCH_SIZE) {
    const rows = await database
      .select({ id: attachment.id })
      .from(attachment)
      .where(
        and(
          inArray(attachment.id, requested.slice(start, start + IMPORT_LOOKUP_BATCH_SIZE)),
          eq(attachment.userId, userId),
        ),
      );
    for (const { id } of rows) owned.add(id);
  }

  let omitted = 0;
  const result = conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      parts: message.parts.map((part): MessagePart => {
        const id = attachmentPartId(part);
        if (!id || owned.has(id)) return part;
        omitted++;
        return { type: "text", text: notice };
      }),
    })),
  }));
  return { conversations: omitted > 0 ? result : conversations, omitted };
}

const UNAVAILABLE_ATTACHMENT_TEXT = "[An attached file is no longer available.]";

/** A chat request referenced an attachment of another user. */
export class ForeignAttachmentError extends Error {
  constructor() {
    super("The request references an attachment of another user.");
    this.name = "ForeignAttachmentError";
  }
}

export type ResolvedAttachments = {
  messages: UIMessage[];
  /**
   * A stable cache key for each signed URL: signed URLs change on every
   * request, the stored file behind them never does. Only files that passed
   * the ownership check have one.
   */
  cacheKeys: Map<string, string>;
};

/**
 * Replace app attachment URLs (`/api/attachments/<id>`, relative or absolute
 * on the app's origin) in user file parts with short-lived signed storage
 * URLs, for the server-side readers: the model receives the downloaded bytes
 * (`fitBinaryAttachmentsToBudget`) or text (`inlineTextAttachments`), never a
 * URL. The caller keeps the original messages for saving.
 *
 * Message parts come from the client. An id of another user's file rejects the
 * request (`ForeignAttachmentError`). A missing (deleted), pending or deleting
 * one becomes a notice, so a chat whose file is gone keeps working, as does
 * any app attachment URL outside a user file part: only user file parts are
 * downloaded, so the provider would otherwise receive the URL itself. Other
 * URLs are left for the existing validation.
 */
export async function resolveAttachmentFileParts(
  messages: UIMessage[],
  userId: string,
  database: AttachmentDatabase = db,
): Promise<ResolvedAttachments> {
  const cacheKeys = new Map<string, string>();
  // Newest first, so the cap keeps the references the model is most likely to read.
  const { ids: requested, referenced } = collectAttachmentIds(messages, MAX_RESOLVED_ATTACHMENTS);
  if (!referenced) return { messages, cacheKeys };

  const rows = await database
    .select({
      id: attachment.id,
      userId: attachment.userId,
      storageKey: attachment.storageKey,
      status: attachment.status,
    })
    .from(attachment)
    .where(inArray(attachment.id, requested));
  if (rows.some((row) => row.userId !== userId)) throw new ForeignAttachmentError();

  const signed = new Map<string, string>();
  if (isStorageConfigured()) {
    await Promise.all(
      rows.map(async ({ id, storageKey, status }) => {
        if (status !== "ready" || !storageKey) return;
        try {
          const url = await signAttachmentUrl(storageKey, ATTACHMENT_FETCH_URL_TTL_SECONDS);
          signed.set(id, url);
          cacheKeys.set(url, `attachment:${userId}:${id}`);
        } catch (error) {
          console.error("[attachments] Failed to sign an attachment URL", error);
        }
      }),
    );
  }

  const resolved = messages.map((message) => {
    let changed = false;
    const parts = message.parts.map((part): MessagePart => {
      const id = attachmentPartId(part);
      if (!id) return part;
      changed = true;
      const url = message.role === "user" && part.type === "file" ? signed.get(id) : undefined;
      return url && part.type === "file"
        ? { ...part, url }
        : { type: "text", text: UNAVAILABLE_ATTACHMENT_TEXT };
    });
    return changed ? { ...message, parts } : message;
  });
  return { messages: resolved, cacheKeys };
}

/**
 * Model messages with each signed attachment URL replaced by the file's stable
 * cache key. Signed URLs change on every request, so a prompt compared with an
 * earlier request's (`fingerprintPromptPrefixes`) must not contain them.
 * Only for comparing: never send the result to a model.
 */
export function withStableAttachmentUrls(
  modelMessages: ModelMessage[],
  cacheKeys: ReadonlyMap<string, string>,
): ModelMessage[] {
  if (cacheKeys.size === 0) return modelMessages;
  const stableKeys = new Map([...cacheKeys].map(([url, key]) => [new URL(url).href, key]));
  return modelMessages.map((message) => {
    if (message.role !== "user" || typeof message.content === "string") return message;
    let changed = false;
    const content = message.content.map((part) => {
      if (part.type !== "file") return part;
      const url =
        part.data instanceof URL
          ? part.data
          : typeof part.data === "object" && "type" in part.data && part.data.type === "url"
            ? part.data.url
            : undefined;
      const key = url && stableKeys.get(url.href);
      if (!key) return part;
      changed = true;
      return { ...part, data: { type: "url" as const, url: new URL(key) } };
    });
    return changed ? { ...message, content } : message;
  });
}
