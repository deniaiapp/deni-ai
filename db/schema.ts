import type { UIMessage } from "ai";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { Store } from "@/lib/types";
import { createdNow, jsonText, timestampMs } from "./columns";

export * from "./auth-schema";

export const userStores = sqliteTable("user_stores", {
  userId: text("user_id").primaryKey(),
  data: jsonText("data").$type<Store>().notNull(),
  createdAt: createdNow("created_at"),
  updatedAt: createdNow("updated_at"),
  // Optimistic-lock counter: D1 has no row locks, so writers compare-and-swap on it.
  version: integer("version").notNull().default(0),
});
// `user_stores_stripe_customer_idx` indexes json_extract(data, '$.billing.stripeCustomerId').
// drizzle-kit cannot emit expression indexes, so it lives in a hand-written migration.

export const threadMessages = sqliteTable(
  "thread_messages",
  {
    userId: text("user_id").notNull(),
    threadId: text("thread_id").notNull(),
    messages: jsonText("messages").$type<UIMessage[]>().notNull(),
    updatedAt: createdNow("updated_at"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.threadId] })],
);

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestampMs("window_start").notNull(),
  count: integer("count").notNull(),
});

export const agentJobs = sqliteTable(
  "agent_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    threadId: text("thread_id").notNull(),
    botId: text("bot_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    payload: jsonText("payload").$type<Record<string, unknown>>().notNull(),
    result: jsonText("result").$type<Record<string, unknown> | null>(),
    checkpoint: jsonText("checkpoint").$type<Record<string, unknown> | null>(),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    idempotencyKey: text("idempotency_key").notNull(),
    error: text("error"),
    lockedAt: timestampMs("locked_at"),
    heartbeatAt: timestampMs("heartbeat_at"),
    startedAt: timestampMs("started_at"),
    finishedAt: timestampMs("finished_at"),
    createdAt: createdNow("created_at"),
    updatedAt: createdNow("updated_at"),
  },
  (table) => [
    index("agent_jobs_user_status_idx").on(table.userId, table.status),
    index("agent_jobs_user_updated_idx").on(table.userId, table.updatedAt),
    uniqueIndex("agent_jobs_user_idempotency_uidx").on(table.userId, table.idempotencyKey),
  ],
);

export const jobEvents = sqliteTable(
  "job_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    jobId: text("job_id").notNull(),
    kind: text("kind").notNull(),
    payload: jsonText("payload").$type<Record<string, unknown>>().notNull(),
    sequence: integer("sequence").notNull(),
    createdAt: createdNow("created_at"),
  },
  (table) => [
    index("job_events_user_job_idx").on(table.userId, table.jobId, table.sequence),
    uniqueIndex("job_events_user_job_sequence_uidx").on(
      table.userId,
      table.jobId,
      table.sequence,
    ),
  ],
);

export const browserWorkspaces = sqliteTable(
  "browser_workspaces",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    jobId: text("job_id").notNull(),
    botId: text("bot_id"),
    pageKey: text("page_key").notNull(),
    status: text("status").notNull().default("idle"),
    url: text("url"),
    title: text("title"),
    takeoverJobId: text("takeover_job_id"),
    updatedAt: createdNow("updated_at"),
    createdAt: createdNow("created_at"),
  },
  (table) => [
    uniqueIndex("browser_workspaces_user_job_uidx").on(table.userId, table.jobId),
    index("browser_workspaces_user_idx").on(table.userId, table.updatedAt),
  ],
);

export const mcpConnections = sqliteTable(
  "mcp_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    transport: text("transport").notNull().default("streamable-http"),
    authSecret: text("auth_secret"),
    headers: jsonText("headers").$type<Record<string, string>>().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastTestAt: timestampMs("last_test_at"),
    lastError: text("last_error"),
    createdAt: createdNow("created_at"),
    updatedAt: createdNow("updated_at"),
  },
  (table) => [
    uniqueIndex("mcp_connections_user_name_uidx").on(table.userId, table.name),
    index("mcp_connections_user_idx").on(table.userId, table.updatedAt),
  ],
);

export const jobArtifacts = sqliteTable(
  "job_artifacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    jobId: text("job_id"),
    threadId: text("thread_id").notNull(),
    botId: text("bot_id"),
    path: text("path").notNull(),
    title: text("title").notNull(),
    mimeType: text("mime_type").notNull().default("text/plain"),
    description: text("description"),
    createdAt: createdNow("created_at"),
    updatedAt: createdNow("updated_at"),
  },
  (table) => [
    index("job_artifacts_user_thread_idx").on(table.userId, table.threadId, table.createdAt),
  ],
);

export const appNotifications = sqliteTable(
  "app_notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    jobId: text("job_id"),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: timestampMs("read_at"),
    createdAt: createdNow("created_at"),
  },
  (table) => [
    index("app_notifications_user_read_idx").on(table.userId, table.readAt, table.createdAt),
  ],
);
