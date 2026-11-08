import { getTableName, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({
  memberships: ["active-team"],
  /** Pages served in order to the paged transcript queries, by table. */
  pages: {} as Record<string, unknown[][]>,
  pagedQueries: [] as { table: string; params: unknown[] }[],
}));
vi.mock("./version", () => ({ appVersion: "test" }));
vi.mock("@/db/drizzle", () => ({
  db: {
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => ({
        where: (condition: SQL) => {
          let rows: unknown[] = [];
          if (getTableName(table) === "projects") {
            const projects = [
              { id: "personal", userId: "user", organizationId: null },
              { id: "current-team-project", userId: "user", organizationId: "active-team" },
              {
                id: "removed-team-project",
                userId: "user",
                organizationId: "removed-team",
                instructions: "New private team information",
              },
            ];
            const query = new PgDialect().sqlToQuery(condition);
            rows = projects.filter(
              (project) =>
                !query.sql.includes('"member"') ||
                !project.organizationId ||
                state.memberships.includes(project.organizationId),
            );
          }
          const result = Promise.resolve(rows);
          const name = getTableName(table);
          const page = () => {
            state.pagedQueries.push({
              table: name,
              params: new PgDialect().sqlToQuery(condition).params,
            });
            return Promise.resolve(state.pages[name]?.shift() ?? []);
          };
          return Object.assign(result, {
            limit: () => result,
            orderBy: () => ({ limit: name in state.pages ? page : () => result }),
          });
        },
      }),
    }),
  },
}));
import { buildAccountExport, EXPORT_TRANSCRIPT_PAGE_SIZE } from "./account-export";
beforeEach(() => {
  state.memberships = ["active-team"];
  state.pages = {};
  state.pagedQueries = [];
});
test("account export never bypasses removal from a team project", async () => {
  const result = await buildAccountExport("user");
  expect(result.projects.map((project) => project.id)).toEqual([
    "personal",
    "current-team-project",
  ]);
  expect(JSON.stringify(result)).not.toContain("New private team information");
});
test("losing all memberships keeps personal data available without exporting team data", async () => {
  state.memberships = [];
  expect((await buildAccountExport("user")).projects.map((project) => project.id)).toEqual([
    "personal",
  ]);
});

const transcript = [
  { id: "q", role: "user", parts: [{ type: "text", text: "Question" }] },
  {
    id: "a",
    role: "assistant",
    parts: [
      { type: "tool-browse", toolCallId: "c", state: "output-available", output: "page" },
      { type: "text", text: "Answer" },
    ],
  },
];
test("saved comparisons are exported with their text", async () => {
  state.pages = {
    chats: [],
    model_comparisons: [
      [
        {
          id: "comparison",
          title: "Question",
          leftModel: "left",
          rightModel: "right",
          leftName: "Left",
          rightName: "Right",
          leftMessages: transcript,
          rightMessages: transcript,
        },
      ],
    ],
  };
  const result = await buildAccountExport("user");
  expect(result.comparisons).toEqual([
    expect.objectContaining({
      id: "comparison",
      leftName: "Left",
      rightName: "Right",
      leftMessages: [
        { role: "user", text: "Question" },
        { role: "assistant", text: "Answer" },
      ],
      rightMessages: [
        { role: "user", text: "Question" },
        { role: "assistant", text: "Answer" },
      ],
    }),
  ]);
});
test("chat transcripts are read page by page after the last id", async () => {
  const chat = (id: string) => ({ id, title: id, messages: transcript });
  const first = Array.from({ length: EXPORT_TRANSCRIPT_PAGE_SIZE }, (_, index) =>
    chat(`chat-${String(index).padStart(3, "0")}`),
  );
  state.pages = { chats: [first, [chat("chat-last")]], model_comparisons: [] };
  const result = await buildAccountExport("user");
  expect(result.chats).toHaveLength(EXPORT_TRANSCRIPT_PAGE_SIZE + 1);
  expect(result.chats.at(-1)).toMatchObject({
    id: "chat-last",
    messages: [
      { role: "user", text: "Question" },
      { role: "assistant", text: "Answer" },
    ],
  });
  const chatQueries = state.pagedQueries.filter((query) => query.table === "chats");
  expect(chatQueries).toHaveLength(2);
  expect(chatQueries[0].params).toEqual(["user"]);
  expect(chatQueries[1].params).toEqual(["user", first.at(-1)?.id]);
});
