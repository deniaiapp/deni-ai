import type { UIMessage } from "ai";
import { type SQL, sql } from "drizzle-orm";

/**
 * One row per chat message (`chat_messages`, defined in @deniai/db).
 *
 * `chats.messages` (jsonb) stays the write-side source of truth while the rows
 * are introduced: every write to it is followed, in the same transaction, by a
 * statement here that derives the rows from the stored jsonb, so both always
 * hold the same transcript. `chats.message_count` marks a chat whose rows are
 * complete; it is NULL for chats written before the rows existed (and never
 * touched since), and reads fall back to the jsonb array for those until the
 * backfill (`scripts/backfill-chat-messages.ts`) or their next write.
 *
 * Statements are raw SQL so they work from any executor (`db` or a
 * transaction) and so the sync can read the jsonb the same statement wrote.
 */

/** `db` or a transaction: anything that can run a raw statement. */
export type SqlExecutor = {
  execute: (query: SQL) => PromiseLike<unknown>;
};

export type ChatMessageRow = {
  seq: number;
  message_id: string;
  role: string;
  parts: unknown;
  metadata: unknown;
};

function idList(chatIds: readonly string[]) {
  return sql.join(
    chatIds.map((id) => sql`${id}`),
    sql`, `,
  );
}

const MESSAGES_ARRAY = sql`CASE WHEN jsonb_typeof(c.messages) = 'array' THEN c.messages ELSE '[]'::jsonb END`;

/**
 * Rewrites the rows of the given chats from their jsonb transcripts: upserts
 * every position (skipping rows whose content is unchanged), deletes positions
 * past the end and records `message_count`. Idempotent; also the backfill step.
 */
export function syncChatMessageRowsSql(chatIds: readonly string[]): SQL {
  return sql`WITH src AS (
    SELECT c.id AS chat_id, (e.ord - 1)::int AS seq, e.m,
      CASE WHEN c.message_count IS NULL THEN c.created_at ELSE now() END AS created_at
    FROM chats c
    CROSS JOIN LATERAL jsonb_array_elements(${MESSAGES_ARRAY}) WITH ORDINALITY AS e(m, ord)
    WHERE c.id IN (${idList(chatIds)})
  ),
  counts AS (
    SELECT c.id AS chat_id, jsonb_array_length(${MESSAGES_ARRAY}) AS n
    FROM chats c
    WHERE c.id IN (${idList(chatIds)})
  ),
  removed AS (
    DELETE FROM chat_messages cm
    USING counts
    WHERE cm.chat_id = counts.chat_id AND cm.seq >= counts.n
  ),
  upserted AS (
    INSERT INTO chat_messages AS cm (chat_id, seq, message_id, role, parts, metadata, created_at)
    SELECT chat_id, seq, COALESCE(m->>'id', ''), COALESCE(m->>'role', ''),
      COALESCE(m->'parts', '[]'::jsonb), m->'metadata', created_at
    FROM src
    ON CONFLICT (chat_id, seq) DO UPDATE SET
      message_id = EXCLUDED.message_id,
      role = EXCLUDED.role,
      parts = EXCLUDED.parts,
      metadata = EXCLUDED.metadata
    WHERE (cm.message_id, cm.role, cm.parts, cm.metadata)
      IS DISTINCT FROM (EXCLUDED.message_id, EXCLUDED.role, EXCLUDED.parts, EXCLUDED.metadata)
  )
  UPDATE chats c SET message_count = counts.n
  FROM counts
  WHERE c.id = counts.chat_id`;
}

/**
 * After a write that only replaced the last jsonb element (streaming
 * checkpoints, stop, final answer): upserts that one row. Skipped for chats
 * without complete rows. If the array length no longer matches the recorded
 * count, the rows are marked incomplete (reads fall back to jsonb) instead of
 * being left stale.
 */
export function syncLastChatMessageRowSql(chatId: string): SQL {
  return sql`WITH tail AS (
    SELECT c.id AS chat_id, c.message_count - 1 AS seq, c.messages->-1 AS m
    FROM chats c
    WHERE c.id = ${chatId}
      AND c.message_count > 0
      AND jsonb_typeof(c.messages) = 'array'
      AND jsonb_array_length(c.messages) = c.message_count
  ),
  upserted AS (
    INSERT INTO chat_messages AS cm (chat_id, seq, message_id, role, parts, metadata)
    SELECT chat_id, seq, COALESCE(m->>'id', ''), COALESCE(m->>'role', ''),
      COALESCE(m->'parts', '[]'::jsonb), m->'metadata'
    FROM tail
    ON CONFLICT (chat_id, seq) DO UPDATE SET
      message_id = EXCLUDED.message_id,
      role = EXCLUDED.role,
      parts = EXCLUDED.parts,
      metadata = EXCLUDED.metadata
  )
  UPDATE chats c SET message_count = NULL
  WHERE c.id = ${chatId}
    AND c.message_count IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM tail)
    AND (jsonb_typeof(c.messages) <> 'array' OR jsonb_array_length(c.messages) <> c.message_count)`;
}

export async function syncChatMessageRows(executor: SqlExecutor, chatIds: readonly string[]) {
  if (chatIds.length === 0) return;
  await executor.execute(syncChatMessageRowsSql(chatIds));
}

export async function syncLastChatMessageRow(executor: SqlExecutor, chatId: string) {
  await executor.execute(syncLastChatMessageRowSql(chatId));
}

/** The recorded row count, or null when the chat's rows are not complete yet. */
export function chatMessageCountSql(chatId: string): SQL {
  return sql`SELECT message_count FROM chats WHERE id = ${chatId}`;
}

/** Rows `[start, end)` of a chat in order. */
export function chatMessageRangeSql(chatId: string, start: number, end: number): SQL {
  return sql`SELECT seq, message_id, role, parts, metadata
    FROM chat_messages
    WHERE chat_id = ${chatId} AND seq >= ${start} AND seq < ${end}
    ORDER BY seq`;
}

/** postgres.js returns the row array itself; other drivers wrap it in `rows`. */
export function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export function rowToUIMessage(row: ChatMessageRow): UIMessage {
  const message: Record<string, unknown> = {
    id: row.message_id,
    role: row.role,
    parts: Array.isArray(row.parts) ? row.parts : [],
  };
  if (row.metadata !== null && row.metadata !== undefined) {
    message.metadata = row.metadata;
  }
  return message as unknown as UIMessage;
}

/**
 * Messages `[start, end)` of a chat whose rows are complete. `start`/`end` are
 * clamped to `[0, total]`.
 */
export async function readChatMessageRange(
  executor: SqlExecutor,
  chatId: string,
  start: number,
  end: number,
): Promise<UIMessage[]> {
  if (end <= start) return [];
  const rows = resultRows<ChatMessageRow>(
    await executor.execute(chatMessageRangeSql(chatId, start, end)),
  );
  return rows.map(rowToUIMessage);
}

export type StoredMessagesWindow = {
  /** Messages `[start, start + messages.length)`; not validated yet. */
  messages: unknown[];
  start: number;
  total: number;
  source: "rows" | "jsonb";
};

/**
 * Reads part of a user's chat transcript: from `chat_messages` when the chat's
 * rows are complete, otherwise from the `chats.messages` jsonb array. `pick`
 * chooses `[start, end)` from the total. Null when the chat is missing or not
 * the user's.
 */
export async function readStoredMessages(
  executor: SqlExecutor,
  chatId: string,
  userId: string,
  pick: (total: number) => { start: number; end: number },
): Promise<StoredMessagesWindow | null> {
  const [chat] = resultRows<{ message_count: number | null }>(
    await executor.execute(
      sql`SELECT message_count FROM chats WHERE id = ${chatId} AND user_id = ${userId} LIMIT 1`,
    ),
  );
  if (!chat) return null;

  if (chat.message_count !== null) {
    const total = chat.message_count;
    const { start, end } = clampWindow(pick(total), total);
    return {
      messages: await readChatMessageRange(executor, chatId, start, end),
      start,
      total,
      source: "rows",
    };
  }

  const [row] = resultRows<{ messages: unknown }>(
    await executor.execute(
      sql`SELECT messages FROM chats WHERE id = ${chatId} AND user_id = ${userId} LIMIT 1`,
    ),
  );
  const all = Array.isArray(row?.messages) ? row.messages : [];
  const { start, end } = clampWindow(pick(all.length), all.length);
  return { messages: all.slice(start, end), start, total: all.length, source: "jsonb" };
}

function clampWindow({ start, end }: { start: number; end: number }, total: number) {
  const clampedEnd = Math.max(0, Math.min(end, total));
  return { start: Math.max(0, Math.min(start, clampedEnd)), end: clampedEnd };
}
