import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  assertNoTransactionControl,
  normalizeParam,
  type Executor,
  type QueryResult,
  type Statement,
} from "./executor";

type SqliteModule = typeof import("node:sqlite");

function loadSqlite(): SqliteModule {
  // getBuiltinModule keeps bundlers from trying to resolve node:sqlite.
  const mod = process.getBuiltinModule("node:sqlite") as SqliteModule | undefined;
  if (!mod) throw new Error("node:sqlite is unavailable. Use Node.js 22.13+ or set D1_PROXY_URL.");
  return mod;
}

function migrate(db: DatabaseSync) {
  db.exec(
    "create table if not exists __local_migrations (name text primary key, applied_at integer not null)",
  );
  const dir = path.join(process.cwd(), "db", "migrations");
  const applied = new Set(
    (db.prepare("select name from __local_migrations").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    db.exec("begin");
    try {
      db.exec(readFileSync(path.join(dir, file), "utf8"));
      db.prepare("insert into __local_migrations (name, applied_at) values (?, ?)").run(
        file,
        Date.now(),
      );
      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      throw error;
    }
  }
}

/** A plain SQLite file for local development and tests. Same dialect as D1. */
export function localExecutor(
  file = process.env.LOCAL_DB_PATH?.trim() || ".deni/local.sqlite",
): Executor {
  const { DatabaseSync } = loadSqlite();
  if (file !== ":memory:") mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000");
  migrate(db);

  function run(statement: Statement): QueryResult {
    const prepared = db.prepare(statement.sql);
    const params = statement.params.map(normalizeParam) as Parameters<typeof prepared.run>;
    if (statement.method === "run") {
      prepared.run(...params);
      return { rows: [] };
    }
    prepared.setReturnArrays(true);
    if (statement.method === "get") return { rows: prepared.get(...params) };
    return { rows: prepared.all(...params) };
  }

  return {
    async query(statement) {
      assertNoTransactionControl(statement.sql);
      return run(statement);
    },
    async batch(statements) {
      for (const statement of statements) assertNoTransactionControl(statement.sql);
      db.exec("begin immediate");
      try {
        const results = statements.map(run);
        db.exec("commit");
        return results;
      } catch (error) {
        db.exec("rollback");
        throw error;
      }
    },
  };
}
