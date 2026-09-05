import "server-only";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalDb = globalThis as typeof globalThis & { __deniPostgres?: ReturnType<typeof postgres> };
const client = globalDb.__deniPostgres ?? postgres(databaseUrl, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  prepare: false,
});
if (process.env.NODE_ENV !== "production") globalDb.__deniPostgres = client;

export const sqlClient = client;
export const db = drizzle(client, { schema });
