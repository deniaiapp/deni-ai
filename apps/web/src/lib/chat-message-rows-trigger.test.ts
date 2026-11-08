import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { createUsageTestDb, seedUser, type UsageTestDb } from "@deniai/billing/testing";
import { markChatRowsWriter, resultRows, syncChatMessageRows } from "./chat-message-rows";

// Migration 0079: while v7 shares the database during the v8 beta, its writes to
// chats.messages do not update chat_messages. The trigger marks such chats
// incomplete (message_count NULL) so v8 reads fall back to the jsonb array,
// while v8's own marked writes keep their rows.

let testDb: UsageTestDb;

beforeAll(async () => {
  testDb = await createUsageTestDb();
  await seedUser(testDb.pglite, "user-1");
});

afterAll(async () => {
  await testDb.pglite.close();
});

beforeEach(async () => {
  await testDb.pglite.exec("DELETE FROM chats");
  await testDb.pglite.query(
    `INSERT INTO chats (id, user_id, title, messages) VALUES ('chat-1', 'user-1', 't', $1)`,
    [JSON.stringify([message("a"), message("b")])],
  );
  await syncChatMessageRows(testDb.db, ["chat-1"]);
});

function message(id: string) {
  return { id, role: "user", parts: [{ type: "text", text: id }] };
}

async function messageCount() {
  const result = await testDb.db.execute(sql`SELECT message_count FROM chats WHERE id = 'chat-1'`);
  return resultRows<{ message_count: number | null }>(result)[0]?.message_count;
}

async function writeMessages(ids: string[]) {
  await testDb.db.execute(
    sql`UPDATE chats SET messages = ${JSON.stringify(ids.map(message))}::jsonb WHERE id = 'chat-1'`,
  );
}

test("the backfilled chat starts with complete rows", async () => {
  expect(await messageCount()).toBe(2);
});

test("an unmarked write (v7) marks the rows incomplete", async () => {
  await writeMessages(["a", "b", "c"]);
  expect(await messageCount()).toBeNull();
});

test("a marked write (v8) keeps the rows and its sync records the new count", async () => {
  await testDb.db.transaction(async (tx) => {
    await markChatRowsWriter(tx);
    await tx.execute(
      sql`UPDATE chats SET messages = ${JSON.stringify(["a", "b", "c"].map(message))}::jsonb WHERE id = 'chat-1'`,
    );
    expect(
      resultRows<{ message_count: number | null }>(
        await tx.execute(sql`SELECT message_count FROM chats WHERE id = 'chat-1'`),
      )[0]?.message_count,
    ).toBe(2);
    await syncChatMessageRows(tx, ["chat-1"]);
  });
  expect(await messageCount()).toBe(3);
});

test("the marker does not outlive its transaction", async () => {
  await testDb.db.transaction(async (tx) => {
    await markChatRowsWriter(tx);
  });
  await writeMessages(["a"]);
  expect(await messageCount()).toBeNull();
});

test("a statement that sets message_count itself is trusted", async () => {
  await testDb.db.execute(
    sql`UPDATE chats SET messages = ${JSON.stringify(["a", "b", "c"].map(message))}::jsonb, message_count = 3 WHERE id = 'chat-1'`,
  );
  expect(await messageCount()).toBe(3);
});

test("updates that leave messages alone keep the count", async () => {
  await testDb.db.execute(sql`UPDATE chats SET title = 'renamed' WHERE id = 'chat-1'`);
  expect(await messageCount()).toBe(2);
});
