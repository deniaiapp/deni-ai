import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  project: {
    id: "project",
    userId: "creator",
    organizationId: "team-a" as string | null,
    name: "Private project",
  },
  memberships: new Map<string, string>(),
  beforeWrite: undefined as (() => void) | undefined,
  deleted: false,
  writes: [] as Array<{ sql: string; params: unknown[] }>,
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/db/drizzle", () => {
  function returning(condition: SQL, fields?: Record<string, unknown>) {
    state.beforeWrite?.();
    state.beforeWrite = undefined;
    const query = new PgDialect().sqlToQuery(condition);
    state.writes.push(query);
    // Model the current-row membership predicates. Without them, an ID-only write
    // succeeds after the authorization snapshot becomes stale.
    if (query.sql.includes('"member"')) {
      const checksCurrentTeam = query.sql.includes(
        '"member"."organization_id" = "projects"."organization_id"',
      );
      const checksCurrentUser = query.sql.match(/"member"\."user_id" = \$(\d+)/);
      if (
        !checksCurrentTeam ||
        !checksCurrentUser ||
        query.params[Number(checksCurrentUser[1]) - 1] !== "admin-user"
      )
        throw new Error("Invalid authorization predicate");
      const role = state.project.organizationId
        ? state.memberships.get(state.project.organizationId)
        : undefined;
      const allowed = state.project.organizationId
        ? Boolean(role) &&
          (state.project.userId === "admin-user" ||
            !query.sql.includes('"member"."role"') ||
            role === "admin" ||
            role === "owner")
        : state.project.userId === "admin-user";
      if (!allowed) return [];
      // Only the creator may change sharing (`currentProjectSharingWhere`).
      const creatorCheck = query.sql.match(/\) and "projects"\."user_id" = \$(\d+)\)/);
      if (creatorCheck && state.project.userId !== query.params[Number(creatorCheck[1]) - 1])
        return [];
      const targetOrganization =
        typeof fields?.organizationId === "string" ? fields.organizationId : undefined;
      if (
        targetOrganization &&
        query.sql.match(/exists/g)?.length === 2 &&
        query.params.includes(targetOrganization) &&
        !state.memberships.has(targetOrganization)
      )
        return [];
    }
    if (fields) Object.assign(state.project, fields);
    else state.deleted = true;
    return [{ ...state.project }];
  }
  const db = {
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const query = {
          innerJoin: () => query,
          where: () => ({
            limit: async () =>
              getTableName(table) === "projects"
                ? [{ ...state.project }]
                : [
                    {
                      id: "membership",
                      role: state.memberships.get("team-a"),
                      organizationName: "Team A",
                    },
                  ],
          }),
        };
        return query;
      },
    }),
    update: () => ({
      set: (fields: Record<string, unknown>) => ({
        where: (condition: SQL) => ({ returning: async () => returning(condition, fields) }),
      }),
    }),
    delete: () => ({
      where: (condition: SQL) => ({ returning: async () => returning(condition) }),
    }),
  };
  return { db };
});

import { db } from "@/db/drizzle";
import { projectsRouter } from "@/server/api/routers/projects";

function caller() {
  return projectsRouter.createCaller({
    db,
    session: { session: { userId: "admin-user" } },
  } as Parameters<typeof projectsRouter.createCaller>[0]);
}
beforeEach(() => {
  state.project = {
    id: "project",
    userId: "creator",
    organizationId: "team-a",
    name: "Private project",
  };
  state.memberships = new Map([
    ["team-a", "admin"],
    ["team-b", "member"],
  ]);
  state.beforeWrite = undefined;
  state.deleted = false;
  state.writes = [];
});

test.each(["archive", "restore", "unshare", "delete"] as const)(
  "%s cannot use membership revoked after the initial check",
  async (operation) => {
    // Only the creator may unshare; the other operations are open to team admins.
    if (operation === "unshare") state.project.userId = "admin-user";
    state.beforeWrite = () => {
      state.memberships.delete("team-a");
    };
    expect(await caller()[operation]({ id: "project" })).toBeNull();
    expect(state.project.organizationId).toBe("team-a");
    expect(state.deleted).toBe(false);
  },
);

test("a previous team admin cannot edit a project concurrently moved into another team", async () => {
  state.memberships.delete("team-b");
  state.beforeWrite = () => {
    state.project.organizationId = "team-b";
  };
  expect(
    await caller().update({
      id: "project",
      name: "Injected",
      description: null,
      instructions: "",
      color: "red",
    }),
  ).toBeNull();
  expect(state.project.name).toBe("Private project");
});

test("sharing rechecks membership in the destination team at write time", async () => {
  state.project.userId = "admin-user";
  state.beforeWrite = () => {
    state.memberships.delete("team-b");
  };
  expect(await caller().share({ id: "project", organizationId: "team-b" })).toBeNull();
  expect(state.project.organizationId).toBe("team-a");
});

test("a current team admin can still manage the project", async () => {
  expect(await caller().archive({ id: "project" })).toMatchObject({
    id: "project",
    organizationId: "team-a",
  });
});

test("a downgraded team admin cannot use the previous role to delete", async () => {
  state.beforeWrite = () => {
    state.memberships.set("team-a", "member");
  };
  expect(await caller().delete({ id: "project" })).toBeNull();
  expect(state.deleted).toBe(false);
});

test("a team admin who did not create the project cannot make it personal", async () => {
  await expect(caller().unshare({ id: "project" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  // The project must not become the (possibly removed) creator's personal project.
  expect(state.project).toMatchObject({ userId: "creator", organizationId: "team-a" });
  expect(state.writes).toEqual([]);
});

test("a team admin who did not create the project cannot move it to another team", async () => {
  state.memberships.set("team-b", "admin");
  await expect(caller().share({ id: "project", organizationId: "team-b" })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(state.project.organizationId).toBe("team-a");
  expect(state.writes).toEqual([]);
});

test("the creator can make their team project personal and keeps it", async () => {
  state.project.userId = "admin-user";
  state.memberships.set("team-a", "member");
  expect(await caller().unshare({ id: "project" })).toMatchObject({
    userId: "admin-user",
    organizationId: null,
  });
});

test("unsharing rechecks the creator at write time", async () => {
  state.project.userId = "admin-user";
  state.beforeWrite = () => {
    // e.g. the project was handed to a team owner in the meantime.
    state.project.userId = "owner-user";
  };
  expect(await caller().unshare({ id: "project" })).toBeNull();
  expect(state.project).toMatchObject({ userId: "owner-user", organizationId: "team-a" });
});
