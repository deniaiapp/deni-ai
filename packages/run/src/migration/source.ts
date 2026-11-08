import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { UIMessage } from "ai";
import type { Store } from "../types";

/**
 * Reads the standalone Deni Run database: a local SQLite file (`.deni/local.sqlite`, the
 * D1 schema) or a `wrangler d1 export` SQL dump, loaded into an in-memory SQLite database.
 * The source is only ever opened read-only (a dump is copied into memory first).
 */

export type SourceUser = { id: string; name: string; email: string };

export type SourceJob = {
  id: string;
  userId: string;
  threadId: string;
  botId: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  checkpoint: Record<string, unknown> | null;
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string;
  error: string | null;
  lockedAt: Date | null;
  heartbeatAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SourceJobEvent = {
  id: string;
  userId: string;
  jobId: string;
  kind: string;
  payload: Record<string, unknown>;
  sequence: number;
  createdAt: Date;
};

export type SourceArtifact = {
  id: string;
  userId: string;
  jobId: string | null;
  threadId: string;
  botId: string | null;
  path: string;
  title: string;
  mimeType: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SourceBrowserWorkspace = {
  id: string;
  userId: string;
  jobId: string;
  botId: string | null;
  pageKey: string;
  status: string;
  url: string | null;
  title: string | null;
  takeoverJobId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SourceMcpConnection = {
  id: string;
  userId: string;
  name: string;
  url: string;
  transport: string;
  authSecret: string | null;
  oauth: string | null;
  catalogId: string | null;
  headers: Record<string, string>;
  enabled: boolean;
  lastTestAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SourceMcpExplanation = {
  userId: string;
  toolCallId: string;
  locale: string;
  text: string;
  createdAt: Date;
};

export type SourceNotification = {
  id: string;
  userId: string;
  jobId: string | null;
  kind: string;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
};

export type SourceDiscordLink = {
  userId: string;
  discordUserId: string;
  discordUsername: string;
  botId: string | null;
  locale: string;
  createdAt: Date;
};

export type SourceDiscordLinkCode = {
  codeHash: string;
  userId: string;
  locale: string;
  expiresAt: Date;
};

/** Everything one Run user owns in the source database. */
export type SourceUserData = {
  user: SourceUser;
  /** Deni AI user id from the `deni-ai` OAuth account, or null when not linked. */
  deniUserId: string | null;
  store: Store | null;
  threadMessages: { threadId: string; messages: UIMessage[] }[];
  jobs: SourceJob[];
  jobEvents: SourceJobEvent[];
  artifacts: SourceArtifact[];
  browserWorkspaces: SourceBrowserWorkspace[];
  mcpConnections: SourceMcpConnection[];
  mcpExplanations: SourceMcpExplanation[];
  notifications: SourceNotification[];
  discordLink: SourceDiscordLink | null;
  discordLinkCodes: SourceDiscordLinkCode[];
};

export type SourceData = {
  users: SourceUserData[];
  /** Rows the migration never copies, by table (`rate_limits`, sessions, passkeys, ...). */
  notMigrated: Record<string, number>;
};

type Row = Record<string, unknown>;

/** Open the source: a SQLite file read-only, or a `.sql` dump loaded into memory. */
export function openSource(path: string): DatabaseSync {
  if (/\.sql$/i.test(path)) {
    const database = new DatabaseSync(":memory:");
    database.exec(readFileSync(path, "utf8"));
    return database;
  }
  return new DatabaseSync(path, { readOnly: true });
}

function tableExists(database: DatabaseSync, name: string) {
  return Boolean(
    database
      .prepare(`SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name),
  );
}

function columns(database: DatabaseSync, table: string) {
  return new Set(
    (
      database.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as { name: string }[]
    ).map((row) => row.name),
  );
}

function rows(database: DatabaseSync, table: string, where = "", ...params: string[]): Row[] {
  if (!tableExists(database, table)) return [];
  return database.prepare(`SELECT * FROM "${table}" ${where}`).all(...params) as Row[];
}

function count(database: DatabaseSync, table: string) {
  if (!tableExists(database, table)) return 0;
  const row = database.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number };
  return Number(row.n);
}

/** Run stored instants as epoch milliseconds (D1 has no timestamp type). */
function ms(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || typeof value === "bigint") return new Date(Number(value));
  if (typeof value === "string") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  }
  return null;
}

function msRequired(value: unknown) {
  return ms(value) ?? new Date(0);
}

function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

export function readSource(database: DatabaseSync): SourceData {
  const users = rows(database, "user").map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    email: String(row.email ?? ""),
  }));
  const links = new Map<string, string>();
  for (const row of rows(database, "account", `WHERE provider_id = 'deni-ai'`))
    links.set(String(row.user_id), String(row.account_id));
  // Stores and messages of users who are missing from `user` (should not happen) are still read.
  const storeUserIds = rows(database, "user_stores").map((row) => String(row.user_id));
  for (const id of storeUserIds)
    if (!users.some((user) => user.id === id)) users.push({ id, name: id, email: "" });

  const mcpColumns = columns(database, "mcp_connections");
  const data: SourceUserData[] = users.map((user) => {
    const [storeRow] = rows(database, "user_stores", "WHERE user_id = ?", user.id);
    const jobs = rows(
      database,
      "agent_jobs",
      "WHERE user_id = ? ORDER BY created_at, id",
      user.id,
    ).map((row): SourceJob => ({
      id: String(row.id),
      userId: user.id,
      threadId: String(row.thread_id),
      botId: String(row.bot_id),
      kind: String(row.kind),
      status: String(row.status),
      payload: json(row.payload, {}),
      result: json(row.result, null),
      checkpoint: json(row.checkpoint, null),
      attempt: Number(row.attempt ?? 0),
      maxAttempts: Number(row.max_attempts ?? 3),
      idempotencyKey: String(row.idempotency_key),
      error: text(row.error),
      lockedAt: ms(row.locked_at),
      heartbeatAt: ms(row.heartbeat_at),
      startedAt: ms(row.started_at),
      finishedAt: ms(row.finished_at),
      createdAt: msRequired(row.created_at),
      updatedAt: msRequired(row.updated_at),
    }));
    const [discord] = rows(database, "discord_links", "WHERE user_id = ?", user.id);
    return {
      user,
      deniUserId: links.get(user.id) ?? null,
      store: storeRow ? json<Store | null>(storeRow.data, null) : null,
      threadMessages: rows(
        database,
        "thread_messages",
        "WHERE user_id = ? ORDER BY thread_id",
        user.id,
      ).map((row) => ({
        threadId: String(row.thread_id),
        messages: json<UIMessage[]>(row.messages, []),
      })),
      jobs,
      jobEvents: rows(
        database,
        "job_events",
        "WHERE user_id = ? ORDER BY job_id, sequence",
        user.id,
      ).map((row) => ({
        id: String(row.id),
        userId: user.id,
        jobId: String(row.job_id),
        kind: String(row.kind),
        payload: json(row.payload, {}),
        sequence: Number(row.sequence),
        createdAt: msRequired(row.created_at),
      })),
      artifacts: rows(
        database,
        "job_artifacts",
        "WHERE user_id = ? ORDER BY created_at, id",
        user.id,
      ).map((row) => ({
        id: String(row.id),
        userId: user.id,
        jobId: text(row.job_id),
        threadId: String(row.thread_id),
        botId: text(row.bot_id),
        path: String(row.path),
        title: String(row.title),
        mimeType: String(row.mime_type ?? "text/plain"),
        description: text(row.description),
        createdAt: msRequired(row.created_at),
        updatedAt: msRequired(row.updated_at),
      })),
      browserWorkspaces: rows(database, "browser_workspaces", "WHERE user_id = ?", user.id).map(
        (row) => ({
          id: String(row.id),
          userId: user.id,
          jobId: String(row.job_id),
          botId: text(row.bot_id),
          pageKey: String(row.page_key),
          status: String(row.status ?? "idle"),
          url: text(row.url),
          title: text(row.title),
          takeoverJobId: text(row.takeover_job_id),
          createdAt: msRequired(row.created_at),
          updatedAt: msRequired(row.updated_at),
        }),
      ),
      mcpConnections: rows(
        database,
        "mcp_connections",
        "WHERE user_id = ? ORDER BY created_at",
        user.id,
      ).map((row) => ({
        id: String(row.id),
        userId: user.id,
        name: String(row.name),
        url: String(row.url),
        transport: String(row.transport ?? "streamable-http"),
        authSecret: text(row.auth_secret),
        oauth: mcpColumns.has("oauth") ? text(row.oauth) : null,
        catalogId: mcpColumns.has("catalog_id") ? text(row.catalog_id) : null,
        headers: json<Record<string, string>>(row.headers, {}),
        enabled: Boolean(Number(row.enabled ?? 1)),
        lastTestAt: ms(row.last_test_at),
        lastError: text(row.last_error),
        createdAt: msRequired(row.created_at),
        updatedAt: msRequired(row.updated_at),
      })),
      mcpExplanations: rows(database, "mcp_explanations", "WHERE user_id = ?", user.id).map(
        (row) => ({
          userId: user.id,
          toolCallId: String(row.tool_call_id),
          locale: String(row.locale),
          text: String(row.text),
          createdAt: msRequired(row.created_at),
        }),
      ),
      notifications: rows(
        database,
        "app_notifications",
        "WHERE user_id = ? ORDER BY created_at",
        user.id,
      ).map((row) => ({
        id: String(row.id),
        userId: user.id,
        jobId: text(row.job_id),
        kind: String(row.kind),
        title: String(row.title),
        body: String(row.body),
        readAt: ms(row.read_at),
        createdAt: msRequired(row.created_at),
      })),
      discordLink: discord
        ? {
            userId: user.id,
            discordUserId: String(discord.discord_user_id),
            discordUsername: String(discord.discord_username),
            botId: text(discord.bot_id),
            locale: String(discord.locale ?? "en"),
            createdAt: msRequired(discord.created_at),
          }
        : null,
      discordLinkCodes: rows(database, "discord_link_codes", "WHERE user_id = ?", user.id).map(
        (row) => ({
          codeHash: String(row.code_hash),
          userId: user.id,
          locale: String(row.locale ?? "en"),
          expiresAt: msRequired(row.expires_at),
        }),
      ),
    };
  });

  const notMigrated: Record<string, number> = {};
  for (const table of [
    "rate_limits",
    "session",
    "verification",
    "two_factor",
    "passkey",
    "auth_rate_limit",
  ]) {
    const n = count(database, table);
    if (n) notMigrated[table] = n;
  }
  return { users: data, notMigrated };
}
