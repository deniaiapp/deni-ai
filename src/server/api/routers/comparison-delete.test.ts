import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";
import type { Context } from "../trpc";

const mocks = vi.hoisted(() => ({
  canCompareModels: vi.fn(async () => false),
  deleteStoredFiles: vi.fn(async () => {}),
}));

vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/lib/usage", () => ({ canCompareModels: mocks.canCompareModels }));
vi.mock("@/lib/upload", () => ({ deleteStoredFiles: mocks.deleteStoredFiles }));

import { attachment, chats, modelComparisons } from "@/db/schema";
import { chatRouter } from "./chat";

const dialect = new PgDialect();
const TABLE_NAMES = new Map<unknown, string>([
  [attachment, "attachment"],
  [chats, "chats"],
  [modelComparisons, "model_comparisons"],
]);

/**
 * A database holding comparison `cmp` of `owner`: a delete returns it only
 * when its filter matches both the id and the owner.
 */
function createCaller(userId: string) {
  const deletes: { table: string; sql: string; params: unknown[] }[] = [];
  const remove = (table: unknown) => ({
    where: (condition: SQL) => {
      const { sql, params } = dialect.sqlToQuery(condition);
      deletes.push({ table: TABLE_NAMES.get(table) ?? "unknown", sql, params });
      const matches =
        table === modelComparisons &&
        sql === '("model_comparisons"."id" = $1 and "model_comparisons"."user_id" = $2)' &&
        params[0] === "cmp" &&
        params[1] === "owner";
      return { returning: async () => (matches ? [{ id: "cmp" }] : []) };
    },
  });
  const database = {
    delete: remove,
    transaction: async (run: (tx: { delete: typeof remove }) => Promise<unknown>) =>
      run({ delete: remove }),
  };
  const caller = chatRouter.createCaller({
    db: database as unknown as Context["db"],
    session: { session: { userId } } as Context["session"],
  });
  return { caller, deletes };
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("deleting a saved comparison removes only that row of its owner", async () => {
  const { caller, deletes } = createCaller("owner");

  expect(await caller.deleteComparison({ id: "cmp" })).toEqual({ id: "cmp" });

  // Its conversations live only in the row: comparison runs never write chats or
  // attachments, and chats saved with Continue this chat are kept.
  expect(deletes).toEqual([
    {
      table: "model_comparisons",
      sql: '("model_comparisons"."id" = $1 and "model_comparisons"."user_id" = $2)',
      params: ["cmp", "owner"],
    },
  ]);
  expect(mocks.deleteStoredFiles).not.toHaveBeenCalled();
});

test("another user's comparison is not found and stays", async () => {
  const { caller, deletes } = createCaller("intruder");

  await expect(caller.deleteComparison({ id: "cmp" })).rejects.toMatchObject({
    code: "NOT_FOUND",
    message: "Comparison not found.",
  });
  // The delete is scoped to the caller, so the owner's row never matched.
  expect(deletes).toHaveLength(1);
  expect(deletes[0]?.params).toEqual(["cmp", "intruder"]);
});

test("an unknown comparison is not found", async () => {
  const { caller } = createCaller("owner");

  await expect(caller.deleteComparison({ id: "missing" })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

test("a saved comparison can be deleted without a plan that can compare", async () => {
  const { caller } = createCaller("owner");

  // Like reading them, deleting saved comparisons stays open after a downgrade.
  expect(await caller.deleteComparison({ id: "cmp" })).toEqual({ id: "cmp" });
  expect(mocks.canCompareModels).not.toHaveBeenCalled();
});

test("an empty id is rejected before touching the database", async () => {
  const { caller, deletes } = createCaller("owner");

  await expect(caller.deleteComparison({ id: "" })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(deletes).toEqual([]);
});
