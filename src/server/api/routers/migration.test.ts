import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";
import type { Context } from "../trpc";

vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
// The request's locale is not read here: messages stay in their English source.
vi.mock("next-intl/server", () => ({
  getExtracted: async () => (message: string) => message,
}));

const { migrationRouter, IMPORT_RATE_LIMIT } = await import("./migration");
const { MAX_IMPORT_CONVERSATIONS, MAX_IMPORT_ITEMS, normalizeMigrationPayload } =
  await import("@/lib/migration");

/** postgres.js rejects statements with this many bind parameters (MAX_PARAMETERS_EXCEEDED). */
const DRIVER_MAX_PARAMETERS = 65_534;
/** uid, title, messages, created_at, updated_at. */
const PARAMETERS_PER_CHAT = 5;

const state = vi.hoisted(() => ({
  committed: [] as unknown[][],
  largestStatement: 0,
  failOnBatch: null as number | null,
  attachments: [] as { id: string; userId: string }[],
}));
const dialect = new PgDialect();

function payload(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    title: `Chat ${index}`,
    messages: [{ role: "user", content: `Question ${index}` }],
  }));
}

/** A driver-like INSERT that enforces postgres.js' bind parameter limit. */
function driver(pending: unknown[][]) {
  return {
    insert: () => ({
      values: (rows: unknown[]) => ({
        returning: async () => {
          const parameters = rows.length * PARAMETERS_PER_CHAT;
          state.largestStatement = Math.max(state.largestStatement, parameters);
          if (parameters >= DRIVER_MAX_PARAMETERS) throw new Error("MAX_PARAMETERS_EXCEEDED");
          if (state.failOnBatch === pending.length) throw new Error("insert failed");
          pending.push(rows);
          return rows.map((_, index) => ({ id: `chat-${index}` }));
        },
      }),
    }),
  };
}

const caller = (session: Context["session"] = { session: { userId: "user-1" } } as never) =>
  migrationRouter.createCaller({
    db: {
      // Statements outside a transaction commit immediately.
      ...driver(state.committed),
      // The importing user's attachment rows among the ids looked up.
      select: () => ({
        from: () => ({
          where: async (condition: SQL) => {
            const { params } = dialect.sqlToQuery(condition);
            return state.attachments.filter(
              (row) => params.includes(row.id) && row.userId === params.at(-1),
            );
          },
        }),
      }),
      transaction: async (run: (tx: unknown) => Promise<unknown>) => {
        const pending: unknown[][] = [];
        const result = await run(driver(pending));
        state.committed.push(...pending);
        return result;
      },
    } as unknown as Context["db"],
    session,
  });

const userSession = (userId: string, isAnonymous = false) =>
  ({ session: { userId }, user: { id: userId, isAnonymous } }) as unknown as Context["session"];

beforeEach(() => {
  state.committed = [];
  state.failOnBatch = null;
  state.largestStatement = 0;
  state.attachments = [];
});

test("imports more tiny chats than one statement can bind", async () => {
  // Small enough for the 25 MB payload cap, but 70,000 bind parameters in one INSERT.
  const total = 14_000;
  const result = await caller().import({ payload: payload(total) });

  expect(result).toMatchObject({ success: true, importedChats: total, importedMessages: total });
  expect(state.committed.flat()).toHaveLength(total);
  expect(state.largestStatement).toBeGreaterThan(0);
  expect(state.largestStatement).toBeLessThan(DRIVER_MAX_PARAMETERS);
});

test("a failing later statement rolls back the whole import", async () => {
  state.failOnBatch = 1;
  await expect(caller().import({ payload: payload(14_000) })).rejects.toThrow("insert failed");
  expect(state.committed).toEqual([]);
});

test("strips NUL characters that Postgres rejects from imported titles and messages", () => {
  const { conversations } = normalizeMigrationPayload([
    {
      title: "Bad\u0000title",
      messages: [
        { role: "user", content: "Hello\u0000world" },
        { role: "assistant", content: "Fine\u0000" },
      ],
    },
  ]);

  expect(conversations).toHaveLength(1);
  expect(conversations[0].title).toBe("Badtitle");
  expect(JSON.stringify(conversations[0].messages)).not.toContain("\\u0000");
  expect(JSON.stringify(conversations[0].messages)).toContain("Helloworld");
});

test("strips lone surrogates that Postgres jsonb rejects from imported titles and messages", () => {
  const halfEmoji = "😀".slice(0, 1);
  const { conversations } = normalizeMigrationPayload([
    { title: `Title ${halfEmoji}`, messages: [{ role: "user", content: `Cut ${halfEmoji}` }] },
  ]);

  expect(conversations[0].title).toBe("Title \uFFFD");
  expect(JSON.stringify(conversations[0].messages)).not.toMatch(/\\ud[89a-f]/i);
  expect(JSON.stringify(conversations[0].messages)).toContain("Cut \uFFFD");
});

test("guest sessions cannot import", async () => {
  await expect(
    caller(userSession("guest", true)).import({ payload: payload(1) }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(state.committed).toEqual([]);
});

test("imports are rate limited per user", async () => {
  const limited = caller(userSession("rate-limited"));
  for (let index = 0; index < IMPORT_RATE_LIMIT.maxRequests; index++) {
    await expect(limited.import({ payload: payload(1) })).resolves.toMatchObject({
      success: true,
    });
  }
  await expect(limited.import({ payload: payload(1) })).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
  });
  // Another account keeps its own allowance.
  await expect(
    caller(userSession("other-user")).import({ payload: payload(1) }),
  ).resolves.toMatchObject({ success: true });
});

test("a small payload cannot fan out into more rows or parts than the import caps", async () => {
  await expect(
    caller(userSession("many-chats")).import({ payload: payload(MAX_IMPORT_CONVERSATIONS + 1) }),
  ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  await expect(
    caller(userSession("many-parts")).import({
      payload: [
        {
          title: "Parts",
          messages: [{ role: "user", parts: Array.from({ length: MAX_IMPORT_ITEMS }, () => "a") }],
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  expect(state.committed).toEqual([]);
});

test("an imported export keeps only the importing user's own attachments", async () => {
  const mine = "m".repeat(32);
  const theirs = "t".repeat(32);
  state.attachments = [
    { id: mine, userId: "user-1" },
    { id: theirs, userId: "someone-else" },
  ];
  const file = (url: string) => ({ type: "file", mediaType: "image/png", filename: "a.png", url });

  const result = await caller().import({
    payload: [
      {
        title: "Exported",
        messages: [
          {
            id: "q",
            role: "user",
            parts: [
              { type: "text", text: "look" },
              file(`/api/attachments/${mine}`),
              // Exported by another account of this deployment: every request of
              // the imported chat would be rejected for it.
              file(`/api/attachments/${theirs}`),
              file("https://example.com/a.png"),
            ],
          },
        ],
      },
    ],
  });

  // A count the import page words in the user's language, not a warning in English.
  expect(result).toMatchObject({
    success: true,
    importedChats: 1,
    importedMessages: 1,
    omittedAttachments: 1,
    warnings: [],
  });
  const [[chat]] = state.committed as { messages: { parts: unknown[] }[] }[][];
  expect(chat?.messages[0]?.parts).toEqual([
    { type: "text", text: "look" },
    file(`/api/attachments/${mine}`),
    { type: "text", text: "[An attached file could not be imported.]" },
    file("https://example.com/a.png"),
  ]);
});

test("a file part without a URL is left out instead of failing the whole import", async () => {
  const result = await caller().import({
    payload: [
      {
        title: "AI SDK v4",
        messages: [
          {
            role: "user",
            parts: [
              { type: "text", text: "look" },
              { type: "file", mimeType: "image/png", data: "iVBORw0KGgo=" },
            ],
          },
          // Nothing usable left: reported like any other unusable message.
          { role: "user", parts: [{ type: "file", url: 42 }] },
        ],
      },
      { title: "Plain", messages: [{ role: "user", content: "hi" }] },
    ],
  });

  expect(result).toMatchObject({ success: true, importedChats: 2, omittedAttachments: 0 });
  const [chats] = state.committed as { messages: { parts: unknown[] }[] }[][];
  expect(chats?.[0]?.messages.map((message) => message.parts)).toEqual([
    [{ type: "text", text: "look" }],
  ]);
});
