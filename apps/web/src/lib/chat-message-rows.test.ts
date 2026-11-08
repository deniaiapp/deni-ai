import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";
import {
  readStoredMessages,
  rowToUIMessage,
  syncChatMessageRowsSql,
  syncLastChatMessageRowSql,
  type SqlExecutor,
} from "./chat-message-rows";

const dialect = new PgDialect();
const render = (query: SQL) => dialect.sqlToQuery(query);
const squash = (text: string) => text.replace(/\s+/g, " ");

describe("syncChatMessageRowsSql", () => {
  test("derives the rows of every listed chat from its jsonb transcript", () => {
    const { sql, params } = render(syncChatMessageRowsSql(["chat-a", "chat-b"]));
    const text = squash(sql);
    // One statement: upsert positions, delete the tail, record the count.
    expect(text).toContain("jsonb_array_elements(");
    expect(text).toContain("WITH ORDINALITY");
    expect(text).toContain("DELETE FROM chat_messages");
    expect(text).toContain("cm.seq >= counts.n");
    expect(text).toContain("ON CONFLICT (chat_id, seq) DO UPDATE");
    expect(text).toContain("UPDATE chats c SET message_count = counts.n");
    expect(params).toEqual(["chat-a", "chat-b", "chat-a", "chat-b"]);
  });

  test("leaves unchanged rows alone", () => {
    expect(squash(render(syncChatMessageRowsSql(["chat-a"])).sql)).toContain(
      "IS DISTINCT FROM (EXCLUDED.message_id, EXCLUDED.role, EXCLUDED.parts, EXCLUDED.metadata)",
    );
  });

  test("treats a non-array transcript as empty", () => {
    expect(squash(render(syncChatMessageRowsSql(["chat-a"])).sql)).toContain(
      "CASE WHEN jsonb_typeof(c.messages) = 'array' THEN c.messages ELSE '[]'::jsonb END",
    );
  });

  test("dates first-time rows by the chat, later ones by now", () => {
    expect(squash(render(syncChatMessageRowsSql(["chat-a"])).sql)).toContain(
      "CASE WHEN c.message_count IS NULL THEN c.created_at ELSE now() END",
    );
  });
});

describe("syncLastChatMessageRowSql", () => {
  const { sql, params } = render(syncLastChatMessageRowSql("chat-a"));
  const text = squash(sql);

  test("upserts only the last position of a chat with complete rows", () => {
    expect(text).toContain("c.message_count - 1 AS seq, c.messages->-1 AS m");
    expect(text).toContain("AND c.message_count > 0");
    expect(text).toContain("AND jsonb_array_length(c.messages) = c.message_count");
    expect(params).toEqual(["chat-a", "chat-a"]);
  });

  test("marks the rows incomplete when the transcript length no longer matches", () => {
    expect(text).toContain("UPDATE chats c SET message_count = NULL");
    expect(text).toContain("jsonb_array_length(c.messages) <> c.message_count");
  });
});

describe("rowToUIMessage", () => {
  test("rebuilds the stored message", () => {
    expect(
      rowToUIMessage({
        seq: 0,
        message_id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "hi" }],
        metadata: { model: "x" },
      }),
    ).toEqual({
      id: "m1",
      role: "assistant",
      parts: [{ type: "text", text: "hi" }],
      metadata: { model: "x" },
    });
  });

  test("omits absent metadata and repairs non-array parts", () => {
    expect(
      rowToUIMessage({ seq: 0, message_id: "m1", role: "user", parts: null, metadata: null }),
    ).toEqual({ id: "m1", role: "user", parts: [] });
  });
});

/** An executor that answers from an in-memory chat, like Postgres would. */
function fakeStore(chat: { messageCount: number | null; messages: unknown[] } | null) {
  const queries: string[] = [];
  const executor: SqlExecutor = {
    execute: async (query) => {
      const { sql, params } = render(query);
      queries.push(squash(sql));
      if (!chat) return [];
      if (sql.includes("SELECT message_count")) return [{ message_count: chat.messageCount }];
      if (sql.includes("SELECT messages")) return [{ messages: chat.messages }];
      if (sql.includes("FROM chat_messages")) {
        const [, start, end] = params as [string, number, number];
        return chat.messages.slice(start, end).map((message, index) => {
          const { id, role, parts, metadata } = message as Record<string, unknown>;
          return { seq: start + index, message_id: id, role, parts, metadata: metadata ?? null };
        });
      }
      throw new Error(`unexpected query ${sql}`);
    },
  };
  return { executor, queries };
}

const transcript = Array.from({ length: 12 }, (_, index) => ({
  id: `m${index}`,
  role: index % 2 === 0 ? "user" : "assistant",
  parts: [{ type: "text", text: `message ${index}` }],
}));

describe("readStoredMessages", () => {
  test("reads a window from rows when the chat's rows are complete", async () => {
    const { executor, queries } = fakeStore({ messageCount: 12, messages: transcript });
    const window = await readStoredMessages(executor, "chat", "user", (total) => ({
      start: total - 5,
      end: total,
    }));
    expect(window).toEqual({
      messages: transcript.slice(7),
      start: 7,
      total: 12,
      source: "rows",
    });
    expect(queries.some((query) => query.includes("SELECT messages"))).toBe(false);
  });

  test("falls back to the jsonb array for chats not backfilled yet", async () => {
    const { executor, queries } = fakeStore({ messageCount: null, messages: transcript });
    const window = await readStoredMessages(executor, "chat", "user", () => ({
      start: 2,
      end: 4,
    }));
    expect(window).toEqual({
      messages: transcript.slice(2, 4),
      start: 2,
      total: 12,
      source: "jsonb",
    });
    expect(queries.some((query) => query.includes("FROM chat_messages"))).toBe(false);
  });

  test("both sources return the same messages", async () => {
    const pick = (total: number) => ({ start: 0, end: total });
    const fromRows = await readStoredMessages(
      fakeStore({ messageCount: 12, messages: transcript }).executor,
      "chat",
      "user",
      pick,
    );
    const fromJsonb = await readStoredMessages(
      fakeStore({ messageCount: null, messages: transcript }).executor,
      "chat",
      "user",
      pick,
    );
    expect(fromRows?.messages).toEqual(fromJsonb?.messages);
  });

  test("clamps the requested window", async () => {
    const { executor } = fakeStore({ messageCount: 12, messages: transcript });
    const window = await readStoredMessages(executor, "chat", "user", () => ({
      start: -3,
      end: 40,
    }));
    expect(window?.start).toBe(0);
    expect(window?.messages).toHaveLength(12);
  });

  test("is null for a missing or foreign chat", async () => {
    const { executor, queries } = fakeStore(null);
    expect(
      await readStoredMessages(executor, "chat", "user", () => ({ start: 0, end: 1 })),
    ).toBeNull();
    expect(queries[0]).toContain("WHERE id = $1 AND user_id = $2");
  });
});
