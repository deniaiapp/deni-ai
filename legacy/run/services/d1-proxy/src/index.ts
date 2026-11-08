// A thin authenticated SQL gateway in front of Cloudflare D1.
//
// D1 can only be bound inside a Worker. The Cloudflare REST API can reach it from
// elsewhere, but it shares the account-wide 1,200 requests / 5 minutes API limit, which
// this app would exhaust. Requests to a Worker are not subject to that limit.
//
//   POST /query  { sql, params, method }          -> { rows }
//   POST /batch  { statements: [{sql,params,method}] } -> { results: [{ rows }] }  (one transaction)
//   GET  /health                                   -> { ok: true }
//
// Rows are arrays of column values, which is what drizzle's sqlite-proxy driver expects.

interface Env {
  DB: D1Database;
  /** Shared secret; set with `wrangler secret put PROXY_TOKEN`. */
  PROXY_TOKEN: string;
}

type Method = "run" | "all" | "values" | "get";

interface Statement {
  sql: string;
  params?: unknown[];
  method?: Method;
}

const MAX_BATCH = 100;
const METHODS = new Set<Method>(["run", "all", "values", "get"]);
// D1 rejects these anyway; refusing them here turns a silent no-op into a clear error.
const FORBIDDEN = /^\s*(begin|commit|end|rollback|savepoint|release|pragma|attach|detach|vacuum)\b/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function authorized(request: Request, env: Env) {
  const header = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${env.PROXY_TOKEN}`;
  if (!env.PROXY_TOKEN || header.length !== expected.length) return false;
  const encoder = new TextEncoder();
  return crypto.subtle.timingSafeEqual(encoder.encode(header), encoder.encode(expected));
}

function validate(statement: Statement): asserts statement is Required<Statement> {
  if (typeof statement?.sql !== "string" || !statement.sql.trim()) throw new HttpError(400, "sql is required");
  if (FORBIDDEN.test(statement.sql)) {
    throw new HttpError(400, "Transaction control and PRAGMA are not allowed. Use /batch for atomic writes.");
  }
  statement.params ??= [];
  statement.method ??= "all";
  if (!Array.isArray(statement.params)) throw new HttpError(400, "params must be an array");
  if (!METHODS.has(statement.method)) throw new HttpError(400, "unknown method");
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function prepare(env: Env, statement: Required<Statement>) {
  return env.DB.prepare(statement.sql).bind(...statement.params);
}

async function runOne(env: Env, statement: Required<Statement>) {
  const prepared = prepare(env, statement);
  if (statement.method === "run") {
    await prepared.run();
    return { rows: [] };
  }
  const rows = await prepared.raw<unknown[]>();
  return { rows: statement.method === "get" ? rows[0] : rows };
}

async function runBatch(env: Env, statements: Required<Statement>[]) {
  // D1 batches are transactional but return rows as objects. Convert back to column
  // arrays; this relies on the SELECT list having distinct column names, which holds for
  // drizzle-generated queries.
  const results = await env.DB.batch(statements.map((statement) => prepare(env, statement)));
  return results.map((result, index) => {
    const method = statements[index]!.method;
    if (method === "run") return { rows: [] };
    const rows = (result.results as Record<string, unknown>[]).map((row) => Object.values(row));
    return { rows: method === "get" ? rows[0] : rows };
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
    if (request.method !== "POST") return json({ error: "Not found" }, 404);
    if (!(await authorized(request, env))) return json({ error: "Unauthorized" }, 401);

    try {
      const body = (await request.json()) as { statements?: Statement[] } & Statement;
      if (url.pathname === "/query") {
        validate(body);
        return json(await runOne(env, body));
      }
      if (url.pathname === "/batch") {
        const statements = body.statements;
        if (!Array.isArray(statements) || statements.length === 0 || statements.length > MAX_BATCH) {
          throw new HttpError(400, `statements must contain 1 to ${MAX_BATCH} items`);
        }
        for (const statement of statements) validate(statement);
        return json({ results: await runBatch(env, statements as Required<Statement>[]) });
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      // D1 errors (constraint violations, bad SQL) are the caller's to handle.
      const message = error instanceof Error ? error.message : String(error);
      return json({ error: message }, /UNIQUE|constraint|syntax|no such/i.test(message) ? 400 : 500);
    }
  },
} satisfies ExportedHandler<Env>;
