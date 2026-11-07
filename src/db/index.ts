import "@tanstack/react-start/server-only";

import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { Executor, Method } from "./executor";
import { localExecutor } from "./local-executor";
import { remoteExecutor } from "./remote-executor";
import * as schema from "./schema";

const globalDb = globalThis as typeof globalThis & { __deniExecutor?: Executor };

function createExecutor(): Executor {
  const url = process.env.D1_PROXY_URL?.trim();
  if (url) {
    const token = process.env.D1_PROXY_TOKEN?.trim();
    if (!token) throw new Error("D1_PROXY_TOKEN is required when D1_PROXY_URL is set");
    return remoteExecutor(url, token);
  }
  if (process.env.NODE_ENV === "production") throw new Error("D1_PROXY_URL is required");
  return localExecutor();
}

// Created on first query so importing this module at build time needs no database.
function executor(): Executor {
  return (globalDb.__deniExecutor ??= createExecutor());
}

export const db = drizzle(
  (sql, params, method: Method) => executor().query({ sql, params, method }),
  (batch) => executor().batch(batch),
  { schema },
);

/** Raw SQL. Rows come back as arrays of column values, in SELECT order. */
export async function rawRows<T extends unknown[] = unknown[]>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await executor().query({ sql, params, method: "all" });
  return result.rows as T[];
}
