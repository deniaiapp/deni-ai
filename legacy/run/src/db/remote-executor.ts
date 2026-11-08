import {
  assertNoTransactionControl,
  normalizeParam,
  type Executor,
  type QueryResult,
  type Statement,
} from "./executor";

const TIMEOUT_MS = 20_000;
const RETRY_STATUS = new Set([429, 502, 503, 504]);

/** Talks to the d1-proxy Worker, which owns the D1 binding. */
export function remoteExecutor(baseUrl: string, token: string): Executor {
  const root = baseUrl.replace(/\/+$/, "");

  async function post<T>(path: string, body: unknown, retry: boolean): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < (retry ? 3 : 1); attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
      try {
        const response = await fetch(`${root}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });
        if (RETRY_STATUS.has(response.status) && retry) {
          lastError = new Error(`D1 proxy returned ${response.status}`);
          continue;
        }
        const text = await response.text();
        if (!response.ok) {
          let message = text.slice(0, 500);
          try {
            message = (JSON.parse(text) as { error?: string }).error ?? message;
          } catch {}
          throw new Error(`D1 proxy ${path} failed (${response.status}): ${message}`);
        }
        return JSON.parse(text) as T;
      } catch (error) {
        lastError = error;
        // A rejected or timed-out write may still have been applied. Only reads are retried.
        if (!retry) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  const wire = (statement: Statement) => ({
    sql: statement.sql,
    params: statement.params.map(normalizeParam),
    method: statement.method,
  });

  return {
    async query(statement) {
      assertNoTransactionControl(statement.sql);
      return post<QueryResult>("/query", wire(statement), statement.method !== "run");
    },
    async batch(statements) {
      for (const statement of statements) assertNoTransactionControl(statement.sql);
      const reads = statements.every((statement) => /^\s*select\b/i.test(statement.sql));
      const body = await post<{ results: QueryResult[] }>(
        "/batch",
        { statements: statements.map(wire) },
        reads,
      );
      return body.results;
    },
  };
}
