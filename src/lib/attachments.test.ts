import type { ModelMessage, UIMessage } from "ai";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";

/** UploadThing app `app`: its public file URLs are `https://app.ufs.sh/f/<key>`. */
const TOKEN = Buffer.from(JSON.stringify({ appId: "app" })).toString("base64");

const mocks = vi.hoisted(() => ({
  configured: true,
  db: {} as unknown,
  env: {} as { NEXT_PUBLIC_BETTER_AUTH_URL: string; UPLOADTHING_TOKEN: string | undefined },
  sign: vi.fn(async (key: string, ttl: number) => `https://app.ufs.sh/f/${key}?ttl=${ttl}`),
  // Reports every key as deleted unless a test says otherwise.
  deleteStoredFiles: vi.fn(
    async (keys: readonly string[], _keyType?: "fileKey" | "customId"): Promise<string[]> => [
      ...keys,
    ],
  ),
  tier: vi.fn(async (_userId: string) => "free" as "free" | "plus" | "pro" | "max"),
}));

vi.mock("@/db/drizzle", () => ({
  get db() {
    return mocks.db;
  },
}));
vi.mock("@/env", () => ({
  get env() {
    return mocks.env;
  },
}));
vi.mock("@/lib/upload", () => ({
  ATTACHMENT_FETCH_URL_TTL_SECONDS: 300,
  deleteStoredFiles: mocks.deleteStoredFiles,
  isStorageConfigured: () => mocks.configured,
  signAttachmentUrl: mocks.sign,
}));
vi.mock("@/lib/usage", () => ({ getSubscriptionTier: mocks.tier }));

const {
  accountDeletionAttachmentHooks,
  attachmentIdFromUrl,
  cleanUpAttachmentStorage,
  collectAccountStoredFiles,
  findReadyAttachmentKey,
  ForeignAttachmentError,
  getStorageLimitForUser,
  getStorageUsageBytes,
  linkChatAttachments,
  markAttachmentReady,
  markChatAttachmentsForDeletion,
  OMITTED_IMPORTED_ATTACHMENT_TEXT,
  omitUnownedAttachmentParts,
  PENDING_ATTACHMENT_TTL_MS,
  purgeDeletingAttachments,
  releaseAttachmentReservation,
  reserveAttachmentStorage,
  resolveAttachmentFileParts,
  rewriteMigratedAttachmentUrls,
  UNLINKED_ATTACHMENT_TTL_MS,
  withStableAttachmentUrls,
} = await import("./attachments");

const MiB = 1024 * 1024;
const dialect = new PgDialect();

type Row = {
  id: string;
  userId: string;
  chatId: string | null;
  storageKey: string | null;
  mediaType: string;
  sizeBytes: number;
  status: "pending" | "ready" | "deleting";
  createdAt: Date;
};

const field = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Evaluates the `=`, `in`, `<` and null checks drizzle renders for these queries. */
function matches(row: Row, condition: SQL) {
  const values = row as unknown as Record<string, unknown>;
  const { sql: text, params } = dialect.sqlToQuery(condition);
  for (const [, column, index] of text.matchAll(/"([a-z_]+)" = \$(\d+)/g)) {
    if (values[field(column)] !== params[Number(index) - 1]) return false;
  }
  for (const [, column, negated] of text.matchAll(/"([a-z_]+)" is (not )?null/g)) {
    if ((values[field(column)] === null) === Boolean(negated)) return false;
  }
  for (const [, column, list] of text.matchAll(/"([a-z_]+)" in \(([^)]*)\)/g)) {
    const allowed = [...list.matchAll(/\$(\d+)/g)].map(([, index]) => params[Number(index) - 1]);
    if (!allowed.includes(values[field(column)])) return false;
  }
  for (const [, column, index] of text.matchAll(/"([a-z_]+)" < \$(\d+)/g)) {
    const bound = new Date(params[Number(index) - 1] as string);
    if (!((values[field(column)] as Date) < bound)) return false;
  }
  return true;
}

const pick = (row: Row, fields: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(fields).map((key) => [key, row[key as keyof Row]]));

/** A chat of `chatRows`, for the lookup of chats that reference an attachment. */
type ChatRow = { id: string; uid: string; updatedAt: Date; messages: UIMessage[] };

/** In-memory attachment table. Every query yields, so unlocked work would interleave. */
function createDatabase(initial: Partial<Row>[] = [], chatRows: ChatRow[] = []) {
  const rows: Row[] = initial.map((row, index) => ({
    id: `row-${index}`,
    userId: "user",
    chatId: null,
    storageKey: null,
    mediaType: "image/png",
    sizeBytes: 0,
    status: "ready",
    createdAt: new Date(),
    ...row,
  }));
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const operations = {
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        where: (condition: SQL) => {
          const result = (async () => {
            await tick();
            const matched = rows.filter((row) => matches(row, condition));
            if ("used" in fields) {
              return [{ used: matched.reduce((total, row) => total + row.sizeBytes, 0) }];
            }
            return matched.map((row) => pick(row, fields));
          })();
          return Object.assign(result, {
            limit: async (count: number) => (await result).slice(0, count),
            // Only `created_at` order is used.
            orderBy: () => ({
              limit: async (count: number) =>
                rows
                  .filter((row) => matches(row, condition))
                  .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
                  .slice(0, count)
                  .map((row) => pick(row, fields)),
            }),
          });
        },
        // Only the join of `markChatAttachmentsForDeletion`: the other chats of
        // the owner whose messages hold a part with the attachment's app URL.
        innerJoin: (_table: unknown, on: SQL) => ({
          where: (condition: SQL) => ({
            orderBy: async () => {
              await tick();
              const { sql: text, params } = dialect.sqlToQuery(on);
              const [, index] = /"chats"\."id" <> \$(\d+)/.exec(text) ?? [];
              const excluded = params[Number(index) - 1];
              const prefixes = params.filter(
                (param): param is string =>
                  typeof param === "string" && param.endsWith("/api/attachments/"),
              );
              return rows
                .filter((row) => matches(row, condition))
                .flatMap((row) =>
                  chatRows
                    .filter(
                      (chat) =>
                        chat.uid === row.userId &&
                        chat.id !== excluded &&
                        chat.messages.some((message) =>
                          message.parts.some(
                            (part) =>
                              "url" in part &&
                              prefixes.some((prefix) => part.url === prefix + row.id),
                          ),
                        ),
                    )
                    .map((chat) => ({ id: row.id, chatId: chat.id, updatedAt: chat.updatedAt })),
                )
                .toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
                .map(({ id, chatId }) => ({ id, chatId }));
            },
          }),
        }),
      }),
    }),
    insert: () => ({
      values: async (values: Partial<Row>) => {
        await tick();
        rows.push({
          chatId: null,
          storageKey: null,
          createdAt: new Date(),
          ...values,
        } as Row);
      },
    }),
    update: () => ({
      set: (values: Partial<Row>) => ({
        where: (condition: SQL) => {
          const result = (async () => {
            await tick();
            const matched = rows.filter((row) => matches(row, condition));
            for (const row of matched) Object.assign(row, values);
            return matched;
          })();
          return Object.assign(result, {
            returning: async (fields: Record<string, unknown> = { id: true }) =>
              (await result).map((row) => pick(row, fields)),
          });
        },
      }),
    }),
    delete: () => ({
      where: (condition: SQL) => {
        const result = (async () => {
          await tick();
          const removed: Row[] = [];
          for (let index = rows.length - 1; index >= 0; index--) {
            if (matches(rows[index], condition)) removed.unshift(...rows.splice(index, 1));
          }
          return removed;
        })();
        return Object.assign(result, {
          returning: async (fields: Record<string, unknown>) =>
            (await result).map((row) => pick(row, fields)),
        });
      },
    }),
  };
  const locks = new Map<unknown, Promise<void>>();
  const database = {
    ...operations,
    transaction: async <T>(run: (tx: unknown) => Promise<T>) => {
      let release = () => {};
      const tx = {
        ...operations,
        execute: async (statement: SQL) => {
          const { sql: text, params } = dialect.sqlToQuery(statement);
          expect(text).toContain("pg_advisory_xact_lock");
          const previous = locks.get(params[0]) ?? Promise.resolve();
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          locks.set(
            params[0],
            previous.then(() => held),
          );
          await previous;
        },
      };
      try {
        return await run(tx);
      } finally {
        release();
      }
    },
  };
  return { rows, database: database as never };
}

beforeEach(() => {
  mocks.configured = true;
  mocks.db = {};
  mocks.env = { NEXT_PUBLIC_BETTER_AUTH_URL: "http://localhost:3000", UPLOADTHING_TOKEN: TOKEN };
  mocks.sign.mockClear();
  mocks.deleteStoredFiles.mockClear();
  mocks.tier.mockReset();
  mocks.tier.mockResolvedValue("free");
});

test("concurrent uploads cannot reserve more than the quota", async () => {
  const { rows, database } = createDatabase();
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      reserveAttachmentStorage(
        { userId: "user", mediaType: "image/png", sizeBytes: 3 * MiB, limitBytes: 10 * MiB },
        database,
      ),
    ),
  );
  expect(results.filter((result) => result.ok)).toHaveLength(3);
  expect(results.filter((result) => !result.ok)).toEqual([
    { ok: false, usedBytes: 9 * MiB, limitBytes: 10 * MiB },
    { ok: false, usedBytes: 9 * MiB, limitBytes: 10 * MiB },
  ]);
  expect(rows.reduce((total, row) => total + row.sizeBytes, 0)).toBe(9 * MiB);
  expect(rows.every((row) => row.status === "pending" && row.storageKey === null)).toBe(true);
  expect(new Set(rows.map((row) => row.id)).size).toBe(3);
  expect(rows.every((row) => /^[A-Za-z0-9_-]{32}$/.test(row.id))).toBe(true);
});

test("uploads in progress count against the quota; abandoned ones are dropped", async () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const stale = new Date(now.getTime() - PENDING_ATTACHMENT_TTL_MS - 1);
  const { rows, database } = createDatabase([
    { id: "stored", sizeBytes: 50 * MiB, storageKey: "k1", createdAt: stale },
    { id: "uploading", sizeBytes: 40 * MiB, status: "pending", createdAt: now },
    { id: "abandoned", sizeBytes: 30 * MiB, status: "pending", createdAt: stale },
    {
      id: "other",
      userId: "someone-else",
      sizeBytes: 90 * MiB,
      status: "pending",
      createdAt: stale,
    },
  ]);
  const reserve = (sizeBytes: number) =>
    reserveAttachmentStorage(
      { userId: "user", mediaType: "application/pdf", sizeBytes, limitBytes: 100 * MiB, now },
      database,
    );

  expect(await reserve(10 * MiB + 1)).toEqual({
    ok: false,
    usedBytes: 90 * MiB,
    limitBytes: 100 * MiB,
  });
  expect(rows.map((row) => row.id)).toEqual(["stored", "uploading", "other"]);
  // Its file may have been stored before the key was recorded: delete it by custom id.
  expect(mocks.deleteStoredFiles).toHaveBeenCalledExactlyOnceWith(["abandoned"], "customId");
  expect((await reserve(10 * MiB)).ok).toBe(true);
  expect(await getStorageUsageBytes("user", database)).toBe(100 * MiB);
  expect(await getStorageUsageBytes("someone-else", database)).toBe(90 * MiB);
});

test("a finished upload records its key; a failed one gives the quota back", async () => {
  const { rows, database } = createDatabase();
  const reserve = () =>
    reserveAttachmentStorage(
      { userId: "user", mediaType: "image/png", sizeBytes: MiB, limitBytes: 10 * MiB },
      database,
    );
  const stored = await reserve();
  const failed = await reserve();
  if (!stored.ok || !failed.ok) throw new Error("expected reservations");

  expect(await markAttachmentReady(stored.id, "key-1", database)).toBe(true);
  expect(rows.find((row) => row.id === stored.id)).toMatchObject({
    status: "ready",
    storageKey: "key-1",
  });
  // A ready row is never re-pointed or released by a late duplicate call.
  expect(await markAttachmentReady(stored.id, "key-2", database)).toBe(false);
  await releaseAttachmentReservation(stored.id, database);
  expect(rows.find((row) => row.id === stored.id)?.storageKey).toBe("key-1");

  await releaseAttachmentReservation(failed.id, database);
  expect(rows.map((row) => row.id)).toEqual([stored.id]);
  expect(await markAttachmentReady(failed.id, "key-3", database)).toBe(false);
});

test("only the owner's stored files resolve to a storage key", async () => {
  const { database } = createDatabase([
    { id: "mine", storageKey: "key-mine" },
    { id: "theirs", userId: "someone-else", storageKey: "key-theirs" },
    { id: "uploading", status: "pending" },
  ]);
  expect(await findReadyAttachmentKey("mine", "user", database)).toBe("key-mine");
  expect(await findReadyAttachmentKey("theirs", "user", database)).toBeNull();
  expect(await findReadyAttachmentKey("uploading", "user", database)).toBeNull();
  expect(await findReadyAttachmentKey("missing", "user", database)).toBeNull();
});

const MINE = "m".repeat(32);
const THEIRS = "t".repeat(32);
const PENDING = "p".repeat(32);
const MISSING = "x".repeat(32);
const DELETING = "d".repeat(32);

function userMessage(id: string, parts: UIMessage["parts"]): UIMessage {
  return { id, role: "user", parts };
}

const file = (url: string, mediaType = "image/png") =>
  ({ type: "file", mediaType, filename: "a.png", url }) as const;

test("the server only signs URLs of the user's own stored attachments", async () => {
  const { database } = createDatabase([
    { id: MINE, storageKey: "key-mine" },
    { id: PENDING, status: "pending" },
    { id: DELETING, storageKey: "key-deleting", status: "deleting" },
  ]);
  const untouched = userMessage("plain", [
    { type: "text", text: "hi" },
    file("data:image/png;base64,AAAA"),
    file("https://example.com/a.png"),
  ]);
  const messages = [
    untouched,
    userMessage("attachments", [
      { type: "text", text: "look" },
      file(`/api/attachments/${MINE}`),
      file(`/api/attachments/${PENDING}`),
      file(`/api/attachments/${MISSING}`),
      file(`/api/attachments/${DELETING}`),
      // The same file by its absolute app URL.
      file(`http://localhost:3000/api/attachments/${MINE}`, "image/png"),
    ]),
  ];

  const { messages: resolved, cacheKeys } = await resolveAttachmentFileParts(
    messages,
    "user",
    database,
  );

  expect(resolved[0]).toBe(untouched);
  // A file that is gone (deleted with its chat, never finished) leaves the chat usable.
  const notice = { type: "text", text: "[An attached file is no longer available.]" };
  expect(resolved[1]?.parts).toEqual([
    { type: "text", text: "look" },
    file("https://app.ufs.sh/f/key-mine?ttl=300"),
    notice,
    notice,
    notice,
    file("https://app.ufs.sh/f/key-mine?ttl=300"),
  ]);
  // The stored history keeps the app URL; only the model's copy is signed.
  expect(messages[1]?.parts[1]).toMatchObject({ url: `/api/attachments/${MINE}` });
  expect(mocks.sign).toHaveBeenCalledTimes(1);
  expect(mocks.sign).toHaveBeenCalledWith("key-mine", 300);
  // Signed URLs change every request; text readers cache the file under a stable key.
  expect(cacheKeys).toEqual(
    new Map([["https://app.ufs.sh/f/key-mine?ttl=300", `attachment:user:${MINE}`]]),
  );
});

test("a request referencing another user's attachment is rejected", async () => {
  const { database } = createDatabase([
    { id: MINE, storageKey: "key-mine" },
    { id: THEIRS, userId: "someone-else", storageKey: "key-theirs" },
  ]);
  for (const url of [
    `/api/attachments/${THEIRS}`,
    `http://localhost:3000/api/attachments/${THEIRS}`,
  ]) {
    await expect(
      resolveAttachmentFileParts(
        [
          userMessage("earlier", [file(url)]),
          userMessage("latest", [file(`/api/attachments/${MINE}`)]),
        ],
        "user",
        database,
      ),
    ).rejects.toBeInstanceOf(ForeignAttachmentError);
  }
  // Nothing is signed for a rejected request.
  expect(mocks.sign).not.toHaveBeenCalled();
});

test("only user file parts are signed: anything else would reach the provider as a URL", async () => {
  const { database } = createDatabase([{ id: MINE, storageKey: "key-mine" }]);
  const notice = { type: "text", text: "[An attached file is no longer available.]" };
  const { messages } = await resolveAttachmentFileParts(
    [
      {
        id: "answer",
        role: "assistant",
        parts: [
          { type: "text", text: "here" },
          file(`/api/attachments/${MINE}`),
          { type: "reasoning-file", mediaType: "image/png", url: `/api/attachments/${MINE}` },
        ],
      },
    ],
    "user",
    database,
  );
  expect(messages[0]?.parts).toEqual([{ type: "text", text: "here" }, notice, notice]);
});

test("app attachment URLs are relative or on the app's own origin", () => {
  const id = MINE;
  expect(attachmentIdFromUrl(`/api/attachments/${id}`)).toBe(id);
  expect(attachmentIdFromUrl(`http://localhost:3000/api/attachments/${id}`)).toBe(id);
  for (const url of [
    `https://evil.example/api/attachments/${id}`,
    `http://localhost:3001/api/attachments/${id}`,
    `http://user:pass@localhost:3000/api/attachments/${id}`,
    `http://localhost:3000/api/attachments/${id}?download=1`,
    `http://localhost:3000/api/attachments/${id}#x`,
    `http://localhost:3000/api/attachments/short`,
    `//localhost:3000/api/attachments/${id}`,
    `/api/attachments/${id}/more`,
    "https://app.ufs.sh/f/key",
  ]) {
    expect(attachmentIdFromUrl(url), url).toBeNull();
  }
});

test("prompts are compared with stable keys instead of signed URLs", () => {
  const signedUrl = "https://app.ufs.sh/f/key-mine?expires=1&signature=a";
  const other = new URL("https://example.com/a.png");
  const prompt = (url: string) =>
    [
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "file", mediaType: "image/png", data: { type: "url", url: new URL(url) } },
          { type: "file", mediaType: "image/png", data: { type: "url", url: other } },
        ],
      },
      { role: "assistant", content: "ok" },
    ] satisfies ModelMessage[];
  const cacheKeys = new Map([[signedUrl, `attachment:user:${MINE}`]]);

  const stable = withStableAttachmentUrls(prompt(signedUrl), cacheKeys);
  const nextRequest = withStableAttachmentUrls(
    prompt("https://app.ufs.sh/f/key-mine?expires=2&signature=b"),
    new Map([["https://app.ufs.sh/f/key-mine?expires=2&signature=b", `attachment:user:${MINE}`]]),
  );
  expect(JSON.stringify(stable)).toBe(JSON.stringify(nextRequest));
  expect(JSON.stringify(stable)).not.toContain("signature");
  expect(JSON.stringify(stable)).toContain("https://example.com/a.png");
  expect(withStableAttachmentUrls(prompt(signedUrl), new Map())).toEqual(prompt(signedUrl));
});

test("without storage, app attachment URLs become notices", async () => {
  mocks.configured = false;
  const { database } = createDatabase([{ id: MINE, storageKey: "key-mine" }]);
  const {
    messages: [message],
    cacheKeys,
  } = await resolveAttachmentFileParts(
    [userMessage("m", [file(`/api/attachments/${MINE}`)])],
    "user",
    database,
  );
  expect(message?.parts).toEqual([
    { type: "text", text: "[An attached file is no longer available.]" },
  ]);
  expect(cacheKeys.size).toBe(0);
  expect(mocks.sign).not.toHaveBeenCalled();
});

test("a tab loaded before the migration has the user's migrated storage URLs read as app URLs", async () => {
  const { database } = createDatabase([
    { id: MINE, storageKey: "key-mine", chatId: "chat" },
    { id: THEIRS, userId: "someone-else", storageKey: "key-theirs" },
  ]);
  const untouched = userMessage("plain", [
    { type: "text", text: "hi" },
    file(`/api/attachments/${MINE}`),
  ]);
  const messages = [
    untouched,
    userMessage("stale", [
      file("https://app.ufs.sh/f/key-mine"),
      file("https://app.ufs.sh/f/key-theirs"),
      file("https://app.ufs.sh/f/key-unmigrated"),
      file("https://other.ufs.sh/f/key-mine"),
    ]),
  ];

  const rewritten = await rewriteMigratedAttachmentUrls(messages, "user", database);

  expect(rewritten[0]).toBe(untouched);
  expect(rewritten[1]?.parts).toEqual([
    // Saved like this, the chat keeps the migrated URL instead of the dead one.
    file(`/api/attachments/${MINE}`),
    // Someone else's, or not migrated yet: left to the public URL.
    file("https://app.ufs.sh/f/key-theirs"),
    file("https://app.ufs.sh/f/key-unmigrated"),
    file("https://other.ufs.sh/f/key-mine"),
  ]);
  expect(messages[1]?.parts[0]).toMatchObject({ url: "https://app.ufs.sh/f/key-mine" });

  // The rewritten file is then read like any stored file of the user.
  const { messages: resolved } = await resolveAttachmentFileParts(rewritten, "user", database);
  expect(resolved[1]?.parts[0]).toEqual(file("https://app.ufs.sh/f/key-mine?ttl=300"));
});

test("migrated URLs are looked up only when present; a failed lookup changes nothing", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const select = vi.fn(() => {
    throw new Error("database unavailable");
  });
  const database = { select } as never;
  const current = [userMessage("m", [file(`/api/attachments/${MINE}`), file("data:,a")])];
  expect(await rewriteMigratedAttachmentUrls(current, "user", database)).toBe(current);

  const stale = [userMessage("m", [file("https://app.ufs.sh/f/key-mine")])];
  mocks.env.UPLOADTHING_TOKEN = undefined;
  expect(await rewriteMigratedAttachmentUrls(stale, "user", database)).toBe(stale);
  expect(select).not.toHaveBeenCalled();

  mocks.env.UPLOADTHING_TOKEN = TOKEN;
  expect(await rewriteMigratedAttachmentUrls(stale, "user", database)).toBe(stale);
  expect(select).toHaveBeenCalledOnce();
});

test("an import keeps only app attachment URLs of the importing user's files", async () => {
  const { database } = createDatabase([
    { id: MINE, storageKey: "key-mine", chatId: "chat" },
    { id: THEIRS, userId: "someone-else", storageKey: "key-theirs" },
  ]);
  const plain = { title: "Plain", messages: [userMessage("q", [{ type: "text", text: "hi" }])] };
  const conversations = [
    {
      title: "Exported",
      messages: [
        userMessage("q", [
          { type: "text", text: "look" },
          file(`/api/attachments/${MINE}`),
          file(`/api/attachments/${THEIRS}`),
          file(`http://localhost:3000/api/attachments/${MISSING}`),
          file("https://example.com/a.png"),
        ]),
      ],
    },
    plain,
  ];

  const result = await omitUnownedAttachmentParts(conversations, "user", database);

  const notice = { type: "text", text: OMITTED_IMPORTED_ATTACHMENT_TEXT };
  expect(result.omitted).toBe(2);
  expect(result.conversations[0]).toMatchObject({ title: "Exported" });
  expect(result.conversations[0]?.messages[0]?.parts).toEqual([
    { type: "text", text: "look" },
    file(`/api/attachments/${MINE}`),
    notice,
    notice,
    file("https://example.com/a.png"),
  ]);
  expect(result.conversations[1]).toEqual(plain);

  // Nothing to check, nothing looked up.
  const select = vi.fn();
  expect(await omitUnownedAttachmentParts([plain], "user", { select } as never)).toEqual({
    conversations: [plain],
    omitted: 0,
  });
  expect(select).not.toHaveBeenCalled();
});

test("guests get the guest quota; signed-in users get their plan tier's", async () => {
  expect(await getStorageLimitForUser("guest", true)).toBe(20 * MiB);
  expect(mocks.tier).not.toHaveBeenCalled();

  mocks.tier.mockResolvedValueOnce("max");
  expect(await getStorageLimitForUser("user", false)).toBe(2048 * MiB);
  mocks.tier.mockResolvedValueOnce("plus");
  expect(await getStorageLimitForUser("user", false)).toBe(500 * MiB);
  expect(mocks.tier).toHaveBeenCalledWith("user");
});

test("files never tied to a chat expire and give their quota back", async () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const expired = new Date(now.getTime() - UNLINKED_ATTACHMENT_TTL_MS - 1);
  const recent = new Date(now.getTime() - UNLINKED_ATTACHMENT_TTL_MS + 60_000);
  const { rows, database } = createDatabase([
    { id: "unsent", sizeBytes: 60 * MiB, storageKey: "key-unsent", createdAt: expired },
    { id: "in-composer", sizeBytes: 20 * MiB, storageKey: "key-composer", createdAt: recent },
    {
      id: "sent",
      sizeBytes: 15 * MiB,
      storageKey: "key-sent",
      chatId: "chat",
      createdAt: expired,
    },
    {
      id: "theirs",
      userId: "someone-else",
      sizeBytes: 60 * MiB,
      storageKey: "key-theirs",
      createdAt: expired,
    },
  ]);

  const reservation = await reserveAttachmentStorage(
    { userId: "user", mediaType: "image/png", sizeBytes: 10 * MiB, limitBytes: 100 * MiB, now },
    database,
  );

  // 60 + 20 + 15 + 10 would not fit; without the expired file it does.
  expect(reservation.ok).toBe(true);
  expect(rows.map((row) => row.id)).toEqual([
    "in-composer",
    "sent",
    "theirs",
    (reservation as { id: string }).id,
  ]);
  expect(mocks.deleteStoredFiles).toHaveBeenCalledExactlyOnceWith(["key-unsent"]);
});

const SENT = "s".repeat(32);
const OTHER_CHAT = "o".repeat(32);

test("sending a chat ties the user's own untied uploads to it", async () => {
  const { rows, database } = createDatabase([
    { id: MINE, storageKey: "key-mine" },
    { id: THEIRS, userId: "someone-else", storageKey: "key-theirs" },
    { id: PENDING, status: "pending" },
    { id: OTHER_CHAT, storageKey: "key-other", chatId: "earlier-chat" },
  ]);
  const messages = [
    userMessage("first", [file(`/api/attachments/${OTHER_CHAT}`)]),
    userMessage("second", [
      { type: "text", text: "look" },
      file(`/api/attachments/${MINE}`),
      file(`/api/attachments/${THEIRS}`),
      file(`/api/attachments/${PENDING}`),
      file("https://example.com/a.png"),
    ]),
  ];

  await linkChatAttachments("chat", "user", messages, database);

  expect(Object.fromEntries(rows.map((row) => [row.id, row.chatId]))).toEqual({
    [MINE]: "chat",
    [THEIRS]: null,
    [PENDING]: null,
    // A file keeps the chat it was first sent in.
    [OTHER_CHAT]: "earlier-chat",
  });
});

test("a failed link never fails the chat request", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const database = {
    update: () => {
      throw new Error("database unavailable");
    },
  } as never;
  await expect(
    linkChatAttachments(
      "chat",
      "user",
      [userMessage("m", [file(`/api/attachments/${MINE}`)])],
      database,
    ),
  ).resolves.toBeUndefined();
});

test("deleting a chat deletes only that chat's attachments of its owner", async () => {
  const { rows, database } = createDatabase([
    { id: MINE, storageKey: "key-mine", chatId: "chat", sizeBytes: 5 * MiB },
    { id: SENT, storageKey: "key-other-chat", chatId: "other-chat", sizeBytes: 3 * MiB },
    { id: PENDING, status: "pending", sizeBytes: MiB },
    { id: "in-composer", storageKey: "key-composer", sizeBytes: MiB },
    { id: THEIRS, userId: "someone-else", storageKey: "key-theirs", chatId: "chat" },
  ]);

  const marked = await markChatAttachmentsForDeletion(database, "user", "chat");
  expect(marked).toEqual([{ id: MINE, storageKey: "key-mine" }]);
  // Marked rows give their quota back at once, before their files are gone.
  expect(await getStorageUsageBytes("user", database)).toBe(5 * MiB);
  expect(await purgeDeletingAttachments(marked, database)).toEqual({ deleted: 1, failed: 0 });
  expect(mocks.deleteStoredFiles).toHaveBeenCalledExactlyOnceWith(["key-mine"]);
  expect(rows.map((row) => row.id)).toEqual([SENT, PENDING, "in-composer", THEIRS]);

  // Every chat: uploads not yet sent stay, they may still be in the composer.
  const all = await markChatAttachmentsForDeletion(database, "user");
  expect(all).toEqual([{ id: SENT, storageKey: "key-other-chat" }]);
  await purgeDeletingAttachments(all, database);
  expect(rows.map((row) => row.id)).toEqual([PENDING, "in-composer", THEIRS]);
});

test("a file that could not be deleted keeps its row for the cron to retry", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { rows, database } = createDatabase([
    { id: MINE, storageKey: "key-mine", chatId: "chat", sizeBytes: 5 * MiB },
    { id: SENT, storageKey: "key-sent", chatId: "chat", sizeBytes: 5 * MiB },
  ]);
  const marked = await markChatAttachmentsForDeletion(database, "user", "chat");
  // UploadThing accepted only one of the files.
  mocks.deleteStoredFiles.mockResolvedValueOnce(["key-sent"]);

  expect(await purgeDeletingAttachments(marked, database)).toEqual({ deleted: 1, failed: 1 });
  expect(rows).toMatchObject([{ id: MINE, status: "deleting" }]);
  // Not counted against the quota while it waits.
  expect(await getStorageUsageBytes("user", database)).toBe(0);
  // Never served or sent to a model again.
  expect(await findReadyAttachmentKey(MINE, "user", database)).toBeNull();

  expect(await cleanUpAttachmentStorage({}, database)).toEqual({
    marked: 0,
    deleted: 1,
    failed: 0,
  });
  expect(mocks.deleteStoredFiles).toHaveBeenLastCalledWith(["key-mine"]);
  expect(rows).toEqual([]);
});

test("deleting a chat keeps a file another chat of its owner still references", async () => {
  const ABSOLUTE = "b".repeat(32);
  const references = (...urls: string[]) => [
    userMessage(
      "q",
      urls.map((url) => file(url)),
    ),
  ];
  const chatRows: ChatRow[] = [
    {
      id: "chat",
      uid: "user",
      updatedAt: new Date(3),
      messages: references(
        `/api/attachments/${MINE}`,
        `/api/attachments/${SENT}`,
        `/api/attachments/${ABSOLUTE}`,
      ),
    },
    // A re-imported copy, and an older one.
    {
      id: "copy",
      uid: "user",
      updatedAt: new Date(2),
      messages: references(
        `/api/attachments/${MINE}`,
        `http://localhost:3000/api/attachments/${ABSOLUTE}`,
      ),
    },
    {
      id: "older-copy",
      uid: "user",
      updatedAt: new Date(1),
      messages: references(`/api/attachments/${MINE}`, `/api/attachments/${OTHER_CHAT}`),
    },
    // Another account's chat never keeps a file of this one.
    {
      id: "theirs",
      uid: "someone-else",
      updatedAt: new Date(4),
      messages: references(`/api/attachments/${SENT}`),
    },
  ];
  const { rows, database } = createDatabase(
    [
      { id: MINE, storageKey: "key-mine", chatId: "chat" },
      { id: SENT, storageKey: "key-sent", chatId: "chat" },
      { id: ABSOLUTE, storageKey: "key-absolute", chatId: "chat" },
      { id: OTHER_CHAT, storageKey: "key-other", chatId: "older-copy" },
    ],
    chatRows,
  );
  const deleteChat = (id: string) =>
    chatRows.splice(
      chatRows.findIndex((chat) => chat.id === id),
      1,
    );

  const marked = await markChatAttachmentsForDeletion(database, "user", "chat");
  deleteChat("chat");

  expect(marked).toEqual([{ id: SENT, storageKey: "key-sent" }]);
  // Kept files move to the most recently updated chat that references them.
  expect(Object.fromEntries(rows.map((row) => [row.id, [row.chatId, row.status]]))).toEqual({
    [MINE]: ["copy", "ready"],
    [SENT]: ["chat", "deleting"],
    [ABSOLUTE]: ["copy", "ready"],
    [OTHER_CHAT]: ["older-copy", "ready"],
  });
  await purgeDeletingAttachments(marked, database);
  expect(mocks.deleteStoredFiles).toHaveBeenCalledExactlyOnceWith(["key-sent"]);

  // Deleting the chat a kept file moved to deletes it once no other chat holds it.
  expect(await markChatAttachmentsForDeletion(database, "user", "copy")).toEqual([
    { id: ABSOLUTE, storageKey: "key-absolute" },
  ]);
  expect(rows.find((row) => row.id === MINE)).toMatchObject({
    chatId: "older-copy",
    status: "ready",
  });
});

test("the storage cleanup deletes abandoned uploads and long-untied files, oldest first", async () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const { rows, database } = createDatabase([
    { id: "abandoned", status: "pending", createdAt: ago(PENDING_ATTACHMENT_TTL_MS + 1) },
    { id: "uploading", status: "pending", createdAt: ago(PENDING_ATTACHMENT_TTL_MS - 60_000) },
    {
      id: "untied",
      storageKey: "key-untied",
      createdAt: ago(UNLINKED_ATTACHMENT_TTL_MS + 1),
    },
    {
      id: "in-composer",
      storageKey: "key-composer",
      createdAt: ago(UNLINKED_ATTACHMENT_TTL_MS - 60_000),
    },
    {
      id: "sent",
      storageKey: "key-sent",
      chatId: "chat",
      createdAt: ago(30 * UNLINKED_ATTACHMENT_TTL_MS),
    },
    {
      id: "theirs-untied",
      userId: "someone-else",
      storageKey: "key-theirs",
      createdAt: ago(2 * UNLINKED_ATTACHMENT_TTL_MS),
    },
    {
      id: "left-behind",
      storageKey: "key-left",
      status: "deleting",
      createdAt: ago(3 * UNLINKED_ATTACHMENT_TTL_MS),
    },
  ]);

  expect(await cleanUpAttachmentStorage({ now }, database)).toEqual({
    marked: 3,
    deleted: 4,
    failed: 0,
  });
  expect(rows.map((row) => row.id)).toEqual(["uploading", "in-composer", "sent"]);
  // A pending upload's key was never recorded: its file goes by custom id.
  expect(mocks.deleteStoredFiles.mock.calls).toEqual([
    [["key-left", "key-theirs", "key-untied"]],
    [["abandoned"], "customId"],
  ]);
});

test("the storage cleanup is bounded per run", async () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const { rows, database } = createDatabase(
    Array.from({ length: 5 }, (_, index) => ({
      id: `untied-${index}`,
      storageKey: `key-${index}`,
      createdAt: new Date(now.getTime() - UNLINKED_ATTACHMENT_TTL_MS - (5 - index) * 1000),
    })),
  );

  expect(await cleanUpAttachmentStorage({ now, limit: 2 }, database)).toEqual({
    marked: 2,
    deleted: 2,
    failed: 0,
  });
  expect(rows.map((row) => row.id)).toEqual(["untied-2", "untied-3", "untied-4"]);
  await cleanUpAttachmentStorage({ now, limit: 2 }, database);
  await cleanUpAttachmentStorage({ now, limit: 2 }, database);
  expect(rows).toEqual([]);
});

test("account deletion collects every stored file of the account", async () => {
  const { database } = createDatabase([
    { id: MINE, storageKey: "key-mine", chatId: "chat" },
    { id: PENDING, status: "pending" },
    { id: DELETING, storageKey: "key-deleting", status: "deleting" },
    { id: THEIRS, userId: "someone-else", storageKey: "key-theirs" },
  ]);
  expect(await collectAccountStoredFiles("user", database)).toEqual({
    keys: ["key-mine", "key-deleting"],
    customIds: [PENDING],
  });
});

test("deleting an account deletes its stored files once the user row is gone", async () => {
  const { rows, database } = createDatabase([
    { id: MINE, storageKey: "key-mine", chatId: "chat" },
    { id: "in-composer", storageKey: "key-composer" },
    { id: PENDING, status: "pending" },
    { id: THEIRS, userId: "someone-else", storageKey: "key-theirs" },
  ]);
  mocks.db = database;

  await accountDeletionAttachmentHooks.before({ id: "user" });
  // The rows are still there until the user delete cascades them.
  expect(rows).toHaveLength(4);
  expect(mocks.deleteStoredFiles).not.toHaveBeenCalled();

  await accountDeletionAttachmentHooks.after({ id: "user" });
  expect(mocks.deleteStoredFiles.mock.calls).toEqual([
    [["key-mine", "key-composer"]],
    [[PENDING], "customId"],
  ]);

  // Nothing is left over for a later deletion of the same id.
  mocks.deleteStoredFiles.mockClear();
  await accountDeletionAttachmentHooks.after({ id: "user" });
  expect(mocks.deleteStoredFiles).not.toHaveBeenCalled();
});

test("a failed read never blocks an account deletion", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.db = {
    select: () => {
      throw new Error("database unavailable");
    },
  };
  await expect(accountDeletionAttachmentHooks.before({ id: "user" })).resolves.toBeUndefined();
  await expect(accountDeletionAttachmentHooks.after({ id: "user" })).resolves.toBeUndefined();
  expect(mocks.deleteStoredFiles).not.toHaveBeenCalled();
});
