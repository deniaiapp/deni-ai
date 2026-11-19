/**
 * Backfills `chat_messages` from `chats.messages` (jsonb) and verifies them.
 *
 *   node --env-file=.env.local scripts/backfill-chat-messages.ts [options]
 *
 *   --dry-run         Count what would be written; change nothing.
 *   --verify          Compare rows with the jsonb transcripts of every chat that
 *                     has complete rows (counts and content); change nothing.
 *   --all             Resync chats that already have rows too (default: only
 *                     chats whose `message_count` is NULL).
 *   --batch-size=N    Chats per transaction (default 200).
 *
 * Idempotent: a chat is synced by one statement that upserts its rows, removes
 * stale positions and records `message_count`, the same statement the app runs
 * after every transcript write (src/lib/chat-message-rows.ts). Safe to stop and
 * rerun; requires the migration that adds `chat_messages`.
 */
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { resultRows, syncChatMessageRows } from "../src/lib/chat-message-rows.ts";

const { values: options } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    verify: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    "batch-size": { type: "string", default: "200" },
  },
});

const batchSize = Number(options["batch-size"]);
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
  throw new Error("--batch-size must be an integer between 1 and 5000");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set; pass --env-file");

const client = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
const db = drizzle({ client });
const target = new URL(databaseUrl);
console.log(`Database: ${target.hostname}:${target.port || 5432}${target.pathname}`);

const MESSAGES_ARRAY = sql`CASE WHEN jsonb_typeof(c.messages) = 'array' THEN c.messages ELSE '[]'::jsonb END`;

/** Next batch of chat ids after `afterId`, in id order (keyset pagination). */
async function nextBatch(afterId: string, onlyPending: boolean) {
  return resultRows<{ id: string; n: number }>(
    await db.execute(sql`SELECT c.id, jsonb_array_length(${MESSAGES_ARRAY}) AS n
      FROM chats c
      WHERE c.id > ${afterId} ${onlyPending ? sql`AND c.message_count IS NULL` : sql``}
      ORDER BY c.id
      LIMIT ${batchSize}`),
  );
}

async function backfill() {
  const dryRun = options["dry-run"];
  let afterId = "";
  let chats = 0;
  let messages = 0;
  for (;;) {
    const batch = await nextBatch(afterId, !options.all);
    if (batch.length === 0) break;
    afterId = batch.at(-1)!.id;
    chats += batch.length;
    messages += batch.reduce((sum, chat) => sum + Number(chat.n), 0);
    if (!dryRun) {
      await db.transaction(async (tx) => {
        await syncChatMessageRows(
          tx,
          batch.map((chat) => chat.id),
        );
      });
    }
    console.log(
      `${dryRun ? "Would sync" : "Synced"} ${chats} chats, ${messages} messages (last id ${afterId})`,
    );
  }
  console.log(
    `${dryRun ? "Dry run: would sync" : "Done: synced"} ${chats} chats with ${messages} messages.`,
  );
}

async function verify() {
  const [summary] = resultRows<{ chats: number; pending: number; rows: number }>(
    await db.execute(sql`SELECT
      (SELECT count(*)::int FROM chats) AS chats,
      (SELECT count(*)::int FROM chats WHERE message_count IS NULL) AS pending,
      (SELECT count(*)::int FROM chat_messages) AS rows`),
  );
  let afterId = "";
  let checked = 0;
  const mismatched: string[] = [];
  for (;;) {
    const batch = resultRows<{ id: string; mismatch: boolean }>(
      await db.execute(sql`SELECT c.id,
        (
          c.message_count <> jsonb_array_length(${MESSAGES_ARRAY})
          OR c.message_count <> (SELECT count(*) FROM chat_messages cm WHERE cm.chat_id = c.id)
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(${MESSAGES_ARRAY}) WITH ORDINALITY AS e(m, ord)
            LEFT JOIN chat_messages cm ON cm.chat_id = c.id AND cm.seq = e.ord - 1
            WHERE cm.chat_id IS NULL
              OR cm.message_id <> COALESCE(e.m->>'id', '')
              OR cm.role <> COALESCE(e.m->>'role', '')
              OR cm.parts <> COALESCE(e.m->'parts', '[]'::jsonb)
              OR cm.metadata IS DISTINCT FROM e.m->'metadata'
          )
        ) AS mismatch
        FROM chats c
        WHERE c.id > ${afterId} AND c.message_count IS NOT NULL
        ORDER BY c.id
        LIMIT ${batchSize}`),
    );
    if (batch.length === 0) break;
    afterId = batch.at(-1)!.id;
    checked += batch.length;
    mismatched.push(...batch.filter((chat) => chat.mismatch).map((chat) => chat.id));
  }
  console.log(
    `Chats: ${summary.chats}, with complete rows: ${checked}, pending backfill: ${summary.pending}, message rows: ${summary.rows}`,
  );
  if (mismatched.length > 0) {
    console.log(`Mismatched chats (${mismatched.length}): ${mismatched.slice(0, 20).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("Verification passed: every chat with rows matches its jsonb transcript.");
  }
}

try {
  if (options.verify) {
    await verify();
  } else {
    await backfill();
  }
} finally {
  await client.end();
}
