import "server-only";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const client = postgres(databaseUrl, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  prepare: false,
});

export const sqlClient = client;
export const db = drizzle(client, { schema });
