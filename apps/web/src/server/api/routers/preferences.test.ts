import { beforeEach, expect, test, vi } from "vitest";
import { models } from "@deniai/ai/models";

vi.mock("@/db/drizzle", () => ({ db: {} }));

const { preferencesRouter } = await import("./preferences");

const state = { stored: null as string | null, writes: [] as unknown[] };

// The two queries the router runs: select…limit for `get`, insert…onConflictDoUpdate for the save.
const db = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => (state.stored ? [{ preferredModel: state.stored }] : []),
      }),
    }),
  }),
  insert: () => ({
    values: (values: { preferredModel: string }) => ({
      onConflictDoUpdate: async (update: unknown) => {
        state.writes.push({ values, update });
        state.stored = values.preferredModel;
      },
    }),
  }),
};

function caller() {
  return preferencesRouter.createCaller({
    db,
    session: { session: { userId: "u1" }, user: { id: "u1", isAnonymous: false } },
  } as unknown as Parameters<typeof preferencesRouter.createCaller>[0]);
}

const knownModel = models[0]!.value;

beforeEach(() => {
  state.stored = null;
  state.writes = [];
});

test("an account without a pick has no preferred model", async () => {
  expect(await caller().get()).toEqual({ preferredModel: null });
});

test("a picked model is saved to the account and read back", async () => {
  expect(await caller().setPreferredModel({ model: knownModel })).toEqual({
    preferredModel: knownModel,
  });
  expect(state.writes).toHaveLength(1);
  expect(await caller().get()).toEqual({ preferredModel: knownModel });
});

test("a model outside the catalog is refused and nothing is written", async () => {
  await expect(caller().setPreferredModel({ model: "not-a-model" })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(state.writes).toHaveLength(0);
});
