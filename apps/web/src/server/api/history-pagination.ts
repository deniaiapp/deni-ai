import { and, lt, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

export const historyCursorSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.string().min(1),
});

export function historyCursorTimestamp(createdAt: PgColumn) {
  // Date truncates PostgreSQL microseconds, which can skip events at page boundaries.
  return sql<string>`to_char(${createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function historyBefore(
  table: { createdAt: PgColumn; id: PgColumn },
  cursor: z.infer<typeof historyCursorSchema> | null | undefined,
) {
  if (!cursor) return undefined;
  return or(
    sql`${table.createdAt} < ${cursor.createdAt}::timestamp`,
    and(sql`${table.createdAt} = ${cursor.createdAt}::timestamp`, lt(table.id, cursor.id)),
  );
}
