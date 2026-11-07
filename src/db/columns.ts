import { sql } from "drizzle-orm";
import { integer, text } from "drizzle-orm/sqlite-core";

// D1 is SQLite: there is no timestamptz or jsonb. Instants are epoch milliseconds and
// documents are JSON text, both mapped back to Date / objects by Drizzle.
export const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });

export const createdNow = (name: string) =>
  timestampMs(name)
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`);

export const jsonText = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
