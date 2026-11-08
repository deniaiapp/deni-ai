import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

/**
 * Deni Run (Run mode, `/run/*`). Every table is keyed by the Deni AI `user.id` and
 * removed with the account. Run's own history stays separate from chat: nothing here
 * references `chat_sessions`. Ids of user-scoped rows (teammates, threads, skills,
 * routines, messages) are only unique per user — Deni Run seeds every account with
 * the same teammate ids (`chief`, `research`, `ops`) — so their keys include
 * `user_id`. Jobs, events, artifacts, notifications and MCP connections carry
 * globally unique ids. JSON columns are typed loosely; `@deniai/run` maps them to its
 * domain types.
 */

type Json = Record<string, unknown>;

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const userId = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

/**
 * One row per user: model and timezone preferences, the live computer state, recent
 * shell commands, handoff snapshots, always-allow lists and Discord preferences.
 */
export const runSettings = pgTable("run_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  model: text("model"),
  runMode: text("run_mode"),
  /** The user's own OpenRouter key, encrypted (`enc:v1:`); null uses the platform key. */
  openrouterApiKey: text("openrouter_api_key"),
  computer: jsonb("computer").$type<Json>(),
  shells: jsonb("shells")
    .$type<Json[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  handoffs: jsonb("handoffs")
    .$type<Json[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** Built-in plugin write actions that run without approval, keyed `${plugin}:${action}`. */
  pluginAlwaysAllow: jsonb("plugin_always_allow")
    .$type<Record<string, boolean>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  /** MCP tools that run without approval, keyed `${connectionId}:${toolName}`. */
  mcpAlwaysAllow: jsonb("mcp_always_allow")
    .$type<Record<string, boolean>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  /** Discord: the group plain DMs go to (null: the chosen teammate) and background notices. */
  discordThreadId: text("discord_thread_id"),
  discordNotify: boolean("discord_notify").notNull().default(true),
  /**
   * Object storage prefix (`users/<storage_key>/...`). Null: the SHA-256 of `user_id`.
   * Accounts migrated from the standalone Deni Run keep the hash of their old Run user
   * id here, so their workspace files and screenshots keep their S3 keys.
   */
  storageKey: text("storage_key"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** AI teammates (Deni Run's bots). */
export const runTeammates = pgTable(
  "run_teammates",
  {
    userId: userId(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    /** Short role line shown under the name ("Research and reports"). */
    job: text("job").notNull().default(""),
    instructions: text("instructions").notNull().default(""),
    accent: text("accent").notNull().default("#7f9bb8"),
    /** Emoji, `character:<name>` or an image URL; null shows the initial. */
    icon: text("icon"),
    /** Tool groups the teammate may use (`web`, `browser`, `files`, `shell`, `mcp`, `plugins`, ...); null: all. */
    tools: jsonb("tools").$type<string[]>(),
    /** Whether the teammate may use the shared computer (browser, files, terminal). */
    computerAccess: boolean("computer_access").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.id] })],
);

/** A teammate's long-term memory entries. */
export const runTeammateMemories = pgTable(
  "run_teammate_memories",
  {
    id: text("id").primaryKey(),
    userId: userId(),
    teammateId: text("teammate_id").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.teammateId],
      foreignColumns: [runTeammates.userId, runTeammates.id],
    }).onDelete("cascade"),
    index("run_teammate_memories_teammate_idx").on(table.userId, table.teammateId, table.createdAt),
  ],
);

/** Direct conversations with one teammate (`dm`) and group conversations (`group`). */
export const runThreads = pgTable(
  "run_threads",
  {
    userId: userId(),
    id: text("id").notNull(),
    kind: text("kind", { enum: ["dm", "group"] }).notNull(),
    title: text("title").notNull(),
    icon: text("icon"),
    lastPreview: text("last_preview").notNull().default(""),
    pinned: boolean("pinned").notNull().default(false),
    unread: boolean("unread").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
    section: text("section"),
    /** Emoji reactions by message id: `{ [messageId]: emoji[] }`. */
    reactions: jsonb("reactions")
      .$type<Record<string, string[]>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Rolling summary of the history no longer sent to the model. */
    historySummary: jsonb("history_summary").$type<{
      throughMessageId: string;
      text: string;
      updatedAt: string;
    }>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index("run_threads_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

/** Teammates in a thread (one for a DM), in display order. */
export const runThreadParticipants = pgTable(
  "run_thread_participants",
  {
    userId: userId(),
    threadId: text("thread_id").notNull(),
    teammateId: text("teammate_id").notNull(),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.threadId, table.teammateId] }),
    foreignKey({
      columns: [table.userId, table.threadId],
      foreignColumns: [runThreads.userId, runThreads.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.teammateId],
      foreignColumns: [runTeammates.userId, runTeammates.id],
    }).onDelete("cascade"),
    index("run_thread_participants_teammate_idx").on(table.userId, table.teammateId),
  ],
);

/** One row per AI SDK `UIMessage`; `seq` orders a thread. */
export const runMessages = pgTable(
  "run_messages",
  {
    userId: userId(),
    threadId: text("thread_id").notNull(),
    id: text("id").notNull(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    role: text("role", { enum: ["system", "user", "assistant"] }).notNull(),
    parts: jsonb("parts").$type<Json[]>().notNull(),
    metadata: jsonb("metadata").$type<Json>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.threadId, table.id] }),
    foreignKey({
      columns: [table.userId, table.threadId],
      foreignColumns: [runThreads.userId, runThreads.id],
    }).onDelete("cascade"),
    index("run_messages_thread_seq_idx").on(table.userId, table.threadId, table.seq),
  ],
);

/** Reusable procedures teammates can load (`useSkill`). */
export const runSkills = pgTable(
  "run_skills",
  {
    userId: userId(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    body: text("body").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.id] })],
);

/** Cron-scheduled work; the scheduler enqueues a job when `next_run_at` passes. */
export const runRoutines = pgTable(
  "run_routines",
  {
    userId: userId(),
    id: text("id").notNull(),
    teammateId: text("teammate_id").notNull(),
    threadId: text("thread_id").notNull(),
    name: text("name").notNull(),
    instructions: text("instructions").notNull(),
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Bumped on every edit so a run queued for an older version is cancelled. */
    revision: integer("revision").notNull().default(0),
    /** Language of the person who last saved the routine; background runs write in it. */
    locale: text("locale"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      columns: [table.userId, table.teammateId],
      foreignColumns: [runTeammates.userId, runTeammates.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.threadId],
      foreignColumns: [runThreads.userId, runThreads.id],
    }).onDelete("cascade"),
    index("run_routines_due_idx")
      .on(table.nextRunAt)
      .where(sql`${table.enabled} AND ${table.nextRunAt} IS NOT NULL`),
  ],
);

/**
 * Durable agent work (a database-backed queue). Workers claim `queued` rows with
 * `FOR UPDATE SKIP LOCKED`, hold a lease (`lease_expires_at`, renewed by heartbeats)
 * and checkpoint after each model step. A lease that expires mid-run marks the job
 * `uncertain` (it may have had external side effects) instead of replaying it.
 */
export const runJobs = pgTable(
  "run_jobs",
  {
    id: text("id").primaryKey(),
    userId: userId(),
    threadId: text("thread_id").notNull(),
    teammateId: text("teammate_id").notNull(),
    kind: text("kind", { enum: ["chat", "routine", "handoff", "retry"] }).notNull(),
    status: text("status", {
      enum: [
        "queued",
        "running",
        "finalizing",
        "waiting_approval",
        "waiting_takeover",
        "paused",
        "uncertain",
        "completed",
        "failed",
        "cancelled",
      ],
    }).notNull(),
    payload: jsonb("payload").$type<Json>().notNull(),
    result: jsonb("result").$type<Json>(),
    checkpoint: jsonb("checkpoint").$type<Json>(),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    idempotencyKey: text("idempotency_key").notNull(),
    error: text("error"),
    /** Worker that holds the lease (`<host>:<pid>:<random>`). */
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    /** Do not claim before this time (retry backoff). */
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("run_jobs_user_idempotency_uidx").on(table.userId, table.idempotencyKey),
    index("run_jobs_claim_idx")
      .on(table.runAfter, table.createdAt)
      .where(sql`${table.status} = 'queued'`),
    index("run_jobs_lease_idx")
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} IN ('running', 'finalizing')`),
    index("run_jobs_user_created_idx").on(table.userId, table.createdAt),
    index("run_jobs_user_thread_idx").on(table.userId, table.threadId, table.createdAt),
  ],
);

/** Ordered progress events of a job (`sequence` starts at 1 per job). */
export const runJobEvents = pgTable(
  "run_job_events",
  {
    id: text("id").primaryKey(),
    userId: userId(),
    jobId: text("job_id")
      .notNull()
      .references(() => runJobs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Json>().notNull(),
    sequence: integer("sequence").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("run_job_events_job_sequence_uidx").on(table.jobId, table.sequence)],
);

/** Deliverables: workspace files registered by a teammate, stored in S3/R2 under `object_key`. */
export const runArtifacts = pgTable(
  "run_artifacts",
  {
    id: text("id").primaryKey(),
    userId: userId(),
    jobId: text("job_id").references(() => runJobs.id, { onDelete: "set null" }),
    threadId: text("thread_id").notNull(),
    teammateId: text("teammate_id"),
    /** Workspace path (`/workspace/outbox/report.md`). */
    path: text("path").notNull(),
    /** Object storage key; null while the workspace has no object storage (local development). */
    objectKey: text("object_key"),
    title: text("title").notNull(),
    mimeType: text("mime_type").notNull().default("text/plain"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("run_artifacts_user_thread_idx").on(table.userId, table.threadId, table.createdAt),
  ],
);

/** Per-job browser pages over the account's shared browser profile. */
export const runBrowserWorkspaces = pgTable(
  "run_browser_workspaces",
  {
    id: text("id").primaryKey(),
    userId: userId(),
    jobId: text("job_id").notNull(),
    teammateId: text("teammate_id"),
    pageKey: text("page_key").notNull(),
    status: text("status").notNull().default("idle"),
    url: text("url"),
    title: text("title"),
    takeoverJobId: text("takeover_job_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("run_browser_workspaces_user_job_uidx").on(table.userId, table.jobId),
    index("run_browser_workspaces_user_idx").on(table.userId, table.updatedAt),
  ],
);

/** Remote MCP servers. `auth_secret` and `oauth` are encrypted with the Run key (`enc:v1:`). */
export const runMcpConnections = pgTable(
  "run_mcp_connections",
  {
    id: text("id").primaryKey(),
    userId: userId(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    transport: text("transport", { enum: ["streamable-http", "sse"] })
      .notNull()
      .default("streamable-http"),
    authSecret: text("auth_secret"),
    oauth: text("oauth"),
    /** Connector catalog entry, or null for a custom server. */
    catalogId: text("catalog_id"),
    headers: jsonb("headers")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    enabled: boolean("enabled").notNull().default(true),
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("run_mcp_connections_user_name_uidx").on(table.userId, table.name),
    index("run_mcp_connections_user_idx").on(table.userId, table.updatedAt),
  ],
);

/** The approval card's plain-language explanation of an MCP call, written once per locale. */
export const runMcpExplanations = pgTable(
  "run_mcp_explanations",
  {
    userId: userId(),
    toolCallId: text("tool_call_id").notNull(),
    locale: text("locale").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.toolCallId, table.locale] })],
);

/** In-app notifications (completed, failed, approval, takeover, info). */
export const runNotifications = pgTable(
  "run_notifications",
  {
    id: text("id").primaryKey(),
    userId: userId(),
    jobId: text("job_id"),
    kind: text("kind", {
      enum: ["completed", "failed", "approval", "takeover", "info"],
    }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index("run_notifications_user_read_idx").on(table.userId, table.readAt, table.createdAt),
  ],
);

/** One Discord account per user; the shared bot only serves linked senders. */
export const runDiscordLinks = pgTable(
  "run_discord_links",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    discordUserId: text("discord_user_id").notNull(),
    discordUsername: text("discord_username").notNull(),
    /** Teammate plain messages go to; null: the first teammate. */
    teammateId: text("teammate_id"),
    locale: text("locale").notNull().default("en"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("run_discord_links_discord_user_uidx").on(table.discordUserId)],
);

/** Short-lived, single-use link codes; only the hash is stored. */
export const runDiscordLinkCodes = pgTable(
  "run_discord_link_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    userId: userId(),
    locale: text("locale").notNull().default("en"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("run_discord_link_codes_user_idx").on(table.userId)],
);
