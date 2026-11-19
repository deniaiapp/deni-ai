import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runTeammates, runTeammateMemories } from "@deniai/db";
import {
  configureRunForTest,
  createRunTestDb,
  resetRunTables,
  seedTestUser,
  type RunTestDb,
} from "../testing";
import { memoryRowId, mutateStore, readStore } from "./store";

let testDb: RunTestDb;
const USER_A = "user-memory-a";
const USER_B = "user-memory-b";

beforeAll(async () => {
  testDb = await createRunTestDb();
  configureRunForTest(testDb);
}, 60_000);

afterAll(async () => {
  await testDb.pglite.close();
});

beforeEach(async () => {
  await resetRunTables(testDb.pglite);
  await seedTestUser(testDb.pglite, USER_A);
  await seedTestUser(testDb.pglite, USER_B);
  await readStore(USER_A);
  await readStore(USER_B);
});

describe("run store teammate memories", () => {
  it("scopes memory row ids per user so two users with the same teammate and memory id never collide", async () => {
    await mutateStore(USER_A, (store) => {
      store.bots[0]!.memory.push({
        id: "m1",
        text: "User A preference",
        createdAt: "2026-10-01T00:00:00.000Z",
      });
    });
    await mutateStore(USER_B, (store) => {
      store.bots[0]!.memory.push({
        id: "m1",
        text: "User B preference",
        createdAt: "2026-10-01T00:00:00.000Z",
      });
    });

    const aStore = await readStore(USER_A);
    const bStore = await readStore(USER_B);
    expect(aStore.bots[0]!.memory.map((m) => ({ id: m.id, text: m.text }))).toEqual([
      { id: "m1", text: "User A preference" },
    ]);
    expect(bStore.bots[0]!.memory.map((m) => ({ id: m.id, text: m.text }))).toEqual([
      { id: "m1", text: "User B preference" },
    ]);

    const rows = await testDb.db
      .select({ id: runTeammateMemories.id, userId: runTeammateMemories.userId })
      .from(runTeammateMemories);
    expect(rows.map((r) => r.id).sort()).toEqual(
      [memoryRowId(USER_A, "chief", "m1"), memoryRowId(USER_B, "chief", "m1")].sort(),
    );
  });

  it("reads, updates, and deletes pre-existing legacy botId:entryId memory rows", async () => {
    const [chief] = await testDb.db
      .select({ id: runTeammates.id })
      .from(runTeammates)
      .where(eq(runTeammates.userId, USER_A));
    expect(chief?.id).toBe("chief");

    await testDb.db.insert(runTeammateMemories).values({
      id: "chief:legacy-1",
      userId: USER_A,
      teammateId: "chief",
      text: "Original legacy memory",
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
    });

    const loaded = await readStore(USER_A);
    expect(loaded.bots[0]!.memory).toEqual([
      {
        id: "legacy-1",
        text: "Original legacy memory",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);

    await mutateStore(USER_A, (store) => {
      store.bots[0]!.memory[0]!.text = "Updated legacy memory";
    });
    const updated = await readStore(USER_A);
    expect(updated.bots[0]!.memory[0]?.text).toBe("Updated legacy memory");

    await mutateStore(USER_A, (store) => {
      store.bots[0]!.memory = [];
    });
    const cleared = await readStore(USER_A);
    expect(cleared.bots[0]!.memory).toEqual([]);
  });
});
