import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";
import type { Context } from "../trpc";

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  // Reports every key as deleted unless a test says otherwise.
  deleteStoredFiles: vi.fn(async (keys: readonly string[]): Promise<string[]> => [...keys]),
}));

vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/lib/usage", () => ({ canCompareModels: async () => true }));
vi.mock("@/lib/upload", () => ({
  ATTACHMENT_FETCH_URL_TTL_SECONDS: 300,
  isStorageConfigured: () => true,
  signAttachmentUrl: vi.fn(),
  deleteStoredFiles: async (keys: readonly string[]) => {
    mocks.events.push("delete files");
    return mocks.deleteStoredFiles(keys);
  },
}));

import { attachment, chats, modelComparisons } from "@/db/schema";
import { chatRouter } from "./chat";

const ATTACHMENTS = [
  { id: "a1", storageKey: "key-1" },
  { id: "a2", storageKey: "key-2" },
];

const dialect = new PgDialect();
const TABLE_NAMES = new Map<unknown, string>([
  [attachment, "attachment"],
  [chats, "chats"],
  [modelComparisons, "model_comparisons"],
]);

/**
 * Records each write with its filter; `results` are the rows each table's
 * write returns (attachment rows for the update that marks them for deletion).
 * `files` are the deleted chat's stored files, and `references` the URLs of
 * them that other chats of the owner hold (newest chat first).
 */
function createCaller(
  results: Map<unknown, unknown[]>,
  references: { chatId: string; url: string }[] = [],
  files: { id: string; storageKey: string }[] = ATTACHMENTS,
) {
  const filters: { op: string; table: string; sql: string; params: unknown[]; set?: unknown }[] =
    [];
  const write = (op: "delete" | "update", table: unknown, condition: SQL, set?: unknown) => {
    const name = TABLE_NAMES.get(table) ?? "unknown";
    mocks.events.push(`${op} ${name}`);
    filters.push({ op, table: name, ...dialect.sqlToQuery(condition), ...(set ? { set } : {}) });
    const rows = results.get(table) ?? [];
    return Object.assign(Promise.resolve(rows), { returning: async () => rows });
  };
  const tx = {
    delete: (table: unknown) => ({ where: (condition: SQL) => write("delete", table, condition) }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: (condition: SQL) => write("update", table, condition, values),
      }),
    }),
    // The deleted chat's stored files, then the other chats referencing them.
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          expect(table).toBe(attachment);
          return files;
        },
        crossJoinLateral: () => ({
          where: (condition: SQL) => ({
            orderBy: async () => {
              expect(table).toBe(chats);
              // One lookup for the URLs of every file, in one read of each chat.
              expect(dialect.sqlToQuery(condition).params).toEqual([
                "owner",
                "chat",
                ...files.flatMap(({ id }) => [
                  `/api/attachments/${id}`,
                  `http://localhost:3000/api/attachments/${id}`,
                ]),
              ]);
              mocks.events.push("find references");
              return references;
            },
          }),
        }),
      }),
    }),
  };
  const db = {
    // Rows whose files are gone are deleted after the commit.
    delete: tx.delete,
    transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => {
      const result = await run(tx);
      mocks.events.push("commit");
      return result;
    },
  };
  const caller = chatRouter.createCaller({
    db: db as unknown as Context["db"],
    session: { session: { userId: "owner" } } as Context["session"],
  });
  return { caller, filters };
}

beforeEach(() => {
  mocks.events = [];
  mocks.deleteStoredFiles.mockClear();
});

test("deleting a chat deletes its attachments and their files", async () => {
  const { caller, filters } = createCaller(
    new Map<unknown, unknown[]>([
      [attachment, ATTACHMENTS],
      [chats, [{ id: "chat", title: "Chat" }]],
    ]),
  );

  expect(await caller.deleteChat({ id: "chat" })).toEqual({ id: "chat", title: "Chat" });

  // Rows are marked before the chat (whose deletion would untie them); files are
  // deleted after the commit, then the rows of the files that are gone.
  expect(mocks.events).toEqual([
    "find references",
    "update attachment",
    "delete chats",
    "commit",
    "delete files",
    "delete attachment",
  ]);
  expect(filters[0]?.set).toEqual({ status: "deleting" });
  expect(filters[0]?.sql).toContain('"attachment"."user_id" = $');
  expect(filters[0]?.sql).toContain('"attachment"."chat_id" = $');
  expect(filters[0]?.params).toEqual(["owner", "chat"]);
  expect(filters[1]?.params).toEqual(["chat", "owner"]);
  expect(mocks.deleteStoredFiles).toHaveBeenCalledExactlyOnceWith(["key-1", "key-2"]);
  expect(filters[2]?.sql).toBe('("attachment"."id" in ($1, $2) and "attachment"."status" = $3)');
  expect(filters[2]?.params).toEqual(["a1", "a2", "deleting"]);
});

test("a file another chat of the owner references moves to that chat instead", async () => {
  const { caller, filters } = createCaller(
    new Map<unknown, unknown[]>([
      [attachment, [ATTACHMENTS[1]]],
      [chats, [{ id: "chat", title: "Chat" }]],
    ]),
    // Newest chat first: a1 is kept by "copy".
    [
      { chatId: "copy", url: "/api/attachments/a1" },
      { chatId: "older-copy", url: "http://localhost:3000/api/attachments/a1" },
    ],
  );

  await caller.deleteChat({ id: "chat" });

  // Moved in the same transaction, before the remaining files are marked.
  expect(mocks.events).toEqual([
    "find references",
    "update attachment",
    "update attachment",
    "delete chats",
    "commit",
    "delete files",
    "delete attachment",
  ]);
  expect(filters[0]).toMatchObject({ set: { chatId: "copy" }, params: ["a1", "owner", "chat"] });
  expect(filters[1]).toMatchObject({ set: { status: "deleting" }, params: ["owner", "chat"] });
  expect(mocks.deleteStoredFiles).toHaveBeenCalledExactlyOnceWith(["key-2"]);
});

test("a file that could not be deleted keeps its row for the storage cleanup", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { caller, filters } = createCaller(
    new Map<unknown, unknown[]>([
      [attachment, ATTACHMENTS],
      [chats, [{ id: "chat", title: "Chat" }]],
    ]),
  );
  mocks.deleteStoredFiles.mockResolvedValueOnce(["key-2"]);

  // The chat is still deleted.
  expect(await caller.deleteChat({ id: "chat" })).toEqual({ id: "chat", title: "Chat" });
  // Only the row of the deleted file goes; the other stays marked `deleting`.
  expect(filters[2]?.params).toEqual(["a2", "deleting"]);
});

test("a chat that is not the user's deletes nothing", async () => {
  // None of the owner's files is tied to it, so no other chat is read either.
  const { caller } = createCaller(new Map(), [], []);

  await expect(caller.deleteChat({ id: "someone-elses" })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  // The transaction is rolled back and no file is touched.
  expect(mocks.events).not.toContain("commit");
  expect(mocks.deleteStoredFiles).not.toHaveBeenCalled();
});

test("deleting all chats deletes every chat attachment of the user", async () => {
  const { caller, filters } = createCaller(
    new Map<unknown, unknown[]>([
      [attachment, [{ id: "a1", storageKey: "key-1" }]],
      [chats, [{ id: "a" }, { id: "b" }]],
    ]),
  );

  expect(await caller.deleteAllChats()).toEqual({ deletedCount: 2 });

  // Every chat goes, so no other chat can keep a file: nothing is looked up.
  expect(mocks.events).toEqual([
    "delete model_comparisons",
    "update attachment",
    "delete chats",
    "commit",
    "delete files",
    "delete attachment",
  ]);
  // Uploads not sent yet are not tied to a chat and stay (they expire on their own).
  expect(filters[1]?.sql).toBe(
    '("attachment"."user_id" = $1 and "attachment"."chat_id" is not null)',
  );
  expect(filters[1]?.params).toEqual(["owner"]);
  expect(mocks.deleteStoredFiles).toHaveBeenCalledExactlyOnceWith(["key-1"]);
});
