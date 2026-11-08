import { getTableColumns } from "drizzle-orm";
import {
  runArtifacts,
  runBrowserWorkspaces,
  runDiscordLinkCodes,
  runDiscordLinks,
  runJobEvents,
  runJobs,
  runMcpConnections,
  runMcpExplanations,
  runMessages,
  runNotifications,
  runRoutines,
  runSettings,
  runSkills,
  runTeammateMemories,
  runTeammates,
  runThreadParticipants,
  runThreads,
} from "@deniai/db";
import type { PgTable } from "drizzle-orm/pg-core";
import type { TargetTable } from "./map";

/** How each target table is written (upsert keys) and compared (`--verify`). */
export type TableSpec = {
  table: PgTable;
  /** SQL table name, for reports. */
  name: string;
  /** Row properties that identify a row (the upsert conflict target). */
  keys: string[];
  /** Columns never rewritten by a re-run. */
  keep?: string[];
};

export const TABLE_SPECS: Record<TargetTable, TableSpec> = {
  settings: { table: runSettings, name: "run_settings", keys: ["userId"], keep: ["createdAt"] },
  teammates: { table: runTeammates, name: "run_teammates", keys: ["userId", "id"] },
  memories: { table: runTeammateMemories, name: "run_teammate_memories", keys: ["id"] },
  threads: { table: runThreads, name: "run_threads", keys: ["userId", "id"] },
  participants: {
    table: runThreadParticipants,
    name: "run_thread_participants",
    keys: ["userId", "threadId", "teammateId"],
  },
  skills: { table: runSkills, name: "run_skills", keys: ["userId", "id"] },
  routines: { table: runRoutines, name: "run_routines", keys: ["userId", "id"] },
  messages: {
    table: runMessages,
    name: "run_messages",
    keys: ["userId", "threadId", "id"],
    keep: ["createdAt"],
  },
  jobs: { table: runJobs, name: "run_jobs", keys: ["id"] },
  jobEvents: { table: runJobEvents, name: "run_job_events", keys: ["id"] },
  artifacts: { table: runArtifacts, name: "run_artifacts", keys: ["id"] },
  browserWorkspaces: { table: runBrowserWorkspaces, name: "run_browser_workspaces", keys: ["id"] },
  mcpConnections: { table: runMcpConnections, name: "run_mcp_connections", keys: ["id"] },
  mcpExplanations: {
    table: runMcpExplanations,
    name: "run_mcp_explanations",
    keys: ["userId", "toolCallId", "locale"],
  },
  notifications: { table: runNotifications, name: "run_notifications", keys: ["id"] },
  discordLinks: { table: runDiscordLinks, name: "run_discord_links", keys: ["userId"] },
  discordLinkCodes: {
    table: runDiscordLinkCodes,
    name: "run_discord_link_codes",
    keys: ["codeHash"],
  },
};

// oxlint-disable-next-line no-explicit-any
export type AnyColumn = any;

export function columnsOf(spec: TableSpec): Record<string, AnyColumn> {
  return getTableColumns(spec.table) as Record<string, AnyColumn>;
}

/** A stable key string for a row (or a selected target row). */
export function rowKey(spec: TableSpec, row: Record<string, unknown>) {
  return spec.keys.map((key) => String(row[key])).join("\u0000");
}
