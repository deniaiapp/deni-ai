import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { expect, test } from "vitest";
import type { db as Db } from "@/db/drizzle";
import { projects } from "@/db/schema";
import { reassignTeamProjectsOnAccountDeletion } from "./project-access";

/** Records the UPDATE the helper would run, without a database. */
function recordingDatabase() {
  const builder = drizzle.mock();
  type Values = Parameters<ReturnType<typeof builder.update<typeof projects>>["set"]>[0];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const database = {
    update: (table: typeof projects) => ({
      set: (values: Values) => ({
        where: async (condition: SQL | undefined) => {
          queries.push(builder.update(table).set(values).where(condition).toSQL());
        },
      }),
    }),
  } as unknown as typeof Db;
  return { database, queries };
}

test("account deletion hands only the user's team projects to another owner or admin", async () => {
  const { database, queries } = recordingDatabase();
  await reassignTeamProjectsOnAccountDeletion(database, "departing-user");

  expect(queries).toHaveLength(1);
  const [{ sql, params }] = queries;
  const [successorUser, rowUser] = params.flatMap((value, index) =>
    value === "departing-user" ? [`$${index + 1}`] : [],
  );

  // Personal projects keep cascading with the account.
  expect(sql).toContain(
    `where ("projects"."user_id" = ${rowUser} and "projects"."organization_id" is not null)`,
  );
  // The successor is another current owner (preferred) or admin of the project's team.
  expect(sql).toContain(`"member"."organization_id" = "projects"."organization_id"`);
  expect(sql).toContain(`"member"."user_id" <> ${successorUser}`);
  expect(sql).toContain(`"member"."role" in ('owner', 'admin')`);
  expect(sql).toContain(`order by "member"."role" = 'owner' desc`);
  // With no one to take it, the row keeps its creator instead of violating NOT NULL.
  expect(sql).toMatch(/set "user_id" = coalesce\(\(select [\s\S]+\), "projects"\."user_id"\)/);
});
