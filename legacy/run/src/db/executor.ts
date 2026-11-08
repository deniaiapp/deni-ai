export type Method = "run" | "all" | "values" | "get";

export interface Statement {
  sql: string;
  params: unknown[];
  method: Method;
}

/** Rows are arrays of column values (the shape drizzle's sqlite-proxy driver expects). */
export interface QueryResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any;
}

export interface Executor {
  query(statement: Statement): Promise<QueryResult>;
  /** Runs every statement atomically: all of them commit, or none do. */
  batch(statements: Statement[]): Promise<QueryResult[]>;
}

// The D1 proxy and the local SQLite file are stateless per call, so a transaction
// spread over several calls cannot work. Refuse it instead of silently not locking.
const transactionControl = /^\s*(begin|commit|end|rollback|savepoint|release)\b/i;

export function assertNoTransactionControl(sql: string) {
  if (transactionControl.test(sql)) {
    throw new Error(
      "Interactive transactions are not supported on D1. Use db.batch() or a conditional update.",
    );
  }
}

export function normalizeParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return Number(value);
  return value;
}
