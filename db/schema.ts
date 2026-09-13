import type { UIMessage } from "ai";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Store } from "@/lib/types";

export * from "./auth-schema";

export const userStores = pgTable(
  "user_stores",
  {
    userId: text("user_id").primaryKey(),
    data: jsonb("data").$type<Store>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("user_stores_stripe_customer_idx").on(
      sql`(${table.data} -> 'billing' ->> 'stripeCustomerId')`,
    ),
  ],
);

export const threadMessages = pgTable(
  "thread_messages",
  {
    userId: text("user_id").notNull(),
    threadId: text("thread_id").notNull(),
    messages: jsonb("messages").$type<UIMessage[]>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.threadId] })],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});

export const agentJobs = pgTable(
  "agent_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    threadId: text("thread_id").notNull(),
    botId: text("bot_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    checkpoint: jsonb("checkpoint").$type<Record<string, unknown> | null>(),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    idempotencyKey: text("idempotency_key").notNull(),
    error: text("error"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_jobs_user_status_idx").on(table.userId, table.status),
    index("agent_jobs_user_updated_idx").on(table.userId, table.updatedAt),
    uniqueIndex("agent_jobs_user_idempotency_uidx").on(table.userId, table.idempotencyKey),
  ],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    jobId: text("job_id").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    sequence: integer("sequence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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

export const browserWorkspaces = pgTable(
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("browser_workspaces_user_job_uidx").on(table.userId, table.jobId),
    index("browser_workspaces_user_idx").on(table.userId, table.updatedAt),
  ],
);

export const mcpConnections = pgTable(
  "mcp_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    transport: text("transport").notNull().default("streamable-http"),
    authSecret: text("auth_secret"),
    headers: jsonb("headers").$type<Record<string, string>>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("mcp_connections_user_name_uidx").on(table.userId, table.name),
    index("mcp_connections_user_idx").on(table.userId, table.updatedAt),
  ],
);

export const jobArtifacts = pgTable(
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("job_artifacts_user_thread_idx").on(table.userId, table.threadId, table.createdAt),
  ],
);

export const appNotifications = pgTable(
  "app_notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    jobId: text("job_id"),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("app_notifications_user_read_idx").on(table.userId, table.readAt, table.createdAt),
  ],
);
