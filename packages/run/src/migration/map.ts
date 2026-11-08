import { createHash } from "node:crypto";
import type {
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
import { normalizeMessageIds } from "../chat/messages";
import { decryptSecretWith, encryptSecretWith, isEncryptedSecret } from "../data/secrets";
import type { ComputerState, Store } from "../types";
import type { SourceUserData } from "./source";

/** Job statuses that are copied; anything else was still in flight and is skipped. */
export const FINISHED_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);

const NOTIFICATION_KINDS = new Set(["completed", "failed", "approval", "takeover", "info"]);
const JOB_KINDS = new Set(["chat", "routine", "handoff", "retry"]);
const MESSAGE_ROLES = new Set(["system", "user", "assistant"]);

export type TargetRows = {
  settings: (typeof runSettings.$inferInsert)[];
  teammates: (typeof runTeammates.$inferInsert)[];
  memories: (typeof runTeammateMemories.$inferInsert)[];
  threads: (typeof runThreads.$inferInsert)[];
  participants: (typeof runThreadParticipants.$inferInsert)[];
  skills: (typeof runSkills.$inferInsert)[];
  routines: (typeof runRoutines.$inferInsert)[];
  messages: (typeof runMessages.$inferInsert)[];
  jobs: (typeof runJobs.$inferInsert)[];
  jobEvents: (typeof runJobEvents.$inferInsert)[];
  artifacts: (typeof runArtifacts.$inferInsert)[];
  browserWorkspaces: (typeof runBrowserWorkspaces.$inferInsert)[];
  mcpConnections: (typeof runMcpConnections.$inferInsert)[];
  mcpExplanations: (typeof runMcpExplanations.$inferInsert)[];
  notifications: (typeof runNotifications.$inferInsert)[];
  discordLinks: (typeof runDiscordLinks.$inferInsert)[];
  discordLinkCodes: (typeof runDiscordLinkCodes.$inferInsert)[];
};

export type TargetTable = keyof TargetRows;

export const TARGET_TABLES: TargetTable[] = [
  "settings",
  "teammates",
  "memories",
  "threads",
  "participants",
  "skills",
  "routines",
  "messages",
  "jobs",
  "jobEvents",
  "artifacts",
  "browserWorkspaces",
  "mcpConnections",
  "mcpExplanations",
  "notifications",
  "discordLinks",
  "discordLinkCodes",
];

/** Something left behind for one user, with the reason. */
export type SkippedItem = { table: string; id: string; reason: string };

export type UserPlan = {
  runUserId: string;
  deniUserId: string;
  rows: TargetRows;
  skipped: SkippedItem[];
  /** Jobs that were still in flight in the source (not migrated). */
  skippedJobs: { id: string; status: string }[];
  /** Secrets (BYOK key, MCP auth secrets, OAuth state, header values) re-encrypted. */
  reencryptedSecrets: number;
  /** Store fields that have no platform equivalent (legacy billing and usage counters). */
  ignoredFields: string[];
};

export class MissingSourceKeyError extends Error {
  constructor() {
    super(
      "The source contains encrypted secrets: pass --source-key-env-file (APP_ENCRYPTION_KEY) or RUN_SOURCE_ENCRYPTION_KEY.",
    );
    this.name = "MissingSourceKeyError";
  }
}

export type MigrationKeys = {
  /** Deni Run's APP_ENCRYPTION_KEY (32 bytes); null when the source has no encrypted secrets. */
  source: Buffer | null;
  /** The platform's Run key (`runEncryptionKey`). */
  target: Buffer;
};

/** The S3 prefix legacy storage used for a Run user (`users/<sha256(user id)>/...`). */
export function legacyStorageKey(runUserId: string) {
  return createHash("sha256").update(runUserId).digest("hex");
}

/** The object key of a workspace file in the legacy bucket layout. */
export function legacyWorkspaceObjectKey(runUserId: string, workspacePath: string) {
  const normalized = workspacePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `users/${legacyStorageKey(runUserId)}/workspace/${normalized}`;
}

/** Placeholder Deni AI id used by rehearsals for Run users without a Deni AI link. */
export function rehearsalUserId(runUserId: string) {
  return `run-rehearsal-${legacyStorageKey(runUserId).slice(0, 12)}`;
}

function reencrypt(value: string | null | undefined, keys: MigrationKeys, counter: { n: number }) {
  if (!value) return null;
  let plain = value;
  if (isEncryptedSecret(value)) {
    if (!keys.source) throw new MissingSourceKeyError();
    plain = decryptSecretWith(keys.source, value);
  }
  counter.n++;
  return encryptSecretWith(keys.target, plain);
}

const date = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const dateOr = (value: string | null | undefined, fallback: Date) => date(value) ?? fallback;

/** Live provider sessions do not survive the move; the per-user Steel profile does. */
function restingComputer(computer: ComputerState | undefined): Record<string, unknown> | null {
  if (!computer) return null;
  return {
    ...computer,
    status: "idle",
    workingBotId: null,
    activeJobId: null,
    workingLabel: "",
    e2bSandboxId: null,
    steelSessionId: null,
    steelDebugUrl: null,
    browserLive: false,
    sandboxLive: false,
    workspaces: {},
    activity: (computer.activity ?? []).slice(0, 40),
  };
}

function emptyRows(): TargetRows {
  return {
    settings: [],
    teammates: [],
    memories: [],
    threads: [],
    participants: [],
    skills: [],
    routines: [],
    messages: [],
    jobs: [],
    jobEvents: [],
    artifacts: [],
    browserWorkspaces: [],
    mcpConnections: [],
    mcpExplanations: [],
    notifications: [],
    discordLinks: [],
    discordLinkCodes: [],
  };
}

/** Map one Run user's source rows to the platform's `run_*` rows for `deniUserId`. */
export function planUser(
  source: SourceUserData,
  deniUserId: string,
  keys: MigrationKeys,
  now = new Date(),
): UserPlan {
  const rows = emptyRows();
  const skipped: SkippedItem[] = [];
  const skippedJobs: { id: string; status: string }[] = [];
  const secrets = { n: 0 };
  const ignoredFields: string[] = [];
  const userId = deniUserId;
  const store: Store | null = source.store;
  const teammateIds = new Set<string>();
  const threadIds = new Set<string>();

  if (store) {
    if (store.billing) ignoredFields.push("billing");
    if (store.usage) ignoredFields.push("usage");
    if (store.jobs?.length) ignoredFields.push("jobs (embedded)");
    rows.settings.push({
      userId,
      timezone: store.config?.timezone || "UTC",
      model: store.config?.model ?? null,
      runMode: store.config?.runMode ?? null,
      openrouterApiKey: reencrypt(store.config?.apiKey, keys, secrets),
      computer: restingComputer(store.computer),
      shells: (store.shells ?? []) as unknown as Record<string, unknown>[],
      handoffs: (store.handoffs ?? []) as unknown as Record<string, unknown>[],
      pluginAlwaysAllow: store.pluginAlwaysAllow ?? {},
      mcpAlwaysAllow: store.mcpAlwaysAllow ?? {},
      discordThreadId: store.discord?.threadId ?? null,
      discordNotify: store.discord?.notify !== false,
      storageKey: legacyStorageKey(source.user.id),
      createdAt: now,
      updatedAt: now,
    });
    for (const [position, bot] of (store.bots ?? []).entries()) {
      teammateIds.add(bot.id);
      rows.teammates.push({
        userId,
        id: bot.id,
        name: bot.name,
        job: bot.job ?? "",
        instructions: bot.instructions ?? "",
        accent: bot.accent || "#7f9bb8",
        icon: bot.icon ?? null,
        tools: null,
        computerAccess: true,
        position,
        createdAt: dateOr(bot.createdAt, now),
        updatedAt: dateOr(bot.updatedAt, now),
      });
      for (const memory of bot.memory ?? [])
        rows.memories.push({
          id: `${bot.id}:${memory.id}`,
          userId,
          teammateId: bot.id,
          text: memory.text,
          createdAt: dateOr(memory.createdAt, now),
        });
    }
    for (const thread of store.threads ?? []) {
      threadIds.add(thread.id);
      rows.threads.push({
        userId,
        id: thread.id,
        kind: thread.kind === "group" ? "group" : "dm",
        title: thread.title,
        icon: thread.icon ?? null,
        lastPreview: thread.lastPreview ?? "",
        pinned: Boolean(thread.pinned),
        unread: Boolean(thread.unread),
        hidden: Boolean(thread.hidden),
        section: thread.section ?? null,
        reactions: thread.reactions ?? {},
        historySummary: store.historySummaries?.[thread.id] ?? null,
        createdAt: dateOr(thread.createdAt, now),
        updatedAt: dateOr(thread.updatedAt, now),
      });
      let position = 0;
      for (const teammateId of new Set(thread.botIds ?? [])) {
        if (!teammateIds.has(teammateId)) {
          skipped.push({
            table: "run_thread_participants",
            id: `${thread.id}/${teammateId}`,
            reason: "teammate no longer exists",
          });
          continue;
        }
        rows.participants.push({ userId, threadId: thread.id, teammateId, position: position++ });
      }
    }
    for (const skill of store.skills ?? [])
      rows.skills.push({
        userId,
        id: skill.id,
        name: skill.name,
        body: skill.body ?? "",
        createdAt: dateOr(skill.createdAt, now),
        updatedAt: dateOr(skill.updatedAt, now),
      });
    for (const routine of store.routines ?? []) {
      if (!teammateIds.has(routine.botId) || !threadIds.has(routine.threadId)) {
        skipped.push({
          table: "run_routines",
          id: routine.id,
          reason: "teammate or thread no longer exists",
        });
        continue;
      }
      rows.routines.push({
        userId,
        id: routine.id,
        teammateId: routine.botId,
        threadId: routine.threadId,
        name: routine.name,
        instructions: routine.instructions,
        cron: routine.cron,
        timezone: routine.timezone || store.config?.timezone || "UTC",
        enabled: routine.enabled,
        revision: routine.revision ?? 0,
        locale: routine.locale ?? null,
        lastRunAt: date(routine.lastRunAt),
        nextRunAt: date(routine.nextRunAt),
        lastError: routine.lastError ?? null,
        createdAt: dateOr(routine.createdAt, now),
        updatedAt: now,
      });
    }
  } else {
    skipped.push({ table: "user_stores", id: source.user.id, reason: "no Run data document" });
  }

  for (const thread of source.threadMessages) {
    if (!threadIds.has(thread.threadId)) {
      skipped.push({
        table: "thread_messages",
        id: thread.threadId,
        reason: `${thread.messages.length} messages of a deleted conversation`,
      });
      continue;
    }
    for (const message of normalizeMessageIds(thread.messages)) {
      if (!MESSAGE_ROLES.has(message.role)) {
        skipped.push({
          table: "run_messages",
          id: message.id,
          reason: `unknown role ${message.role}`,
        });
        continue;
      }
      rows.messages.push({
        userId,
        threadId: thread.threadId,
        id: message.id,
        role: message.role,
        parts: message.parts as unknown as Record<string, unknown>[],
        metadata: (message.metadata as Record<string, unknown> | undefined) ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const migratedJobs = new Set<string>();
  for (const job of source.jobs) {
    if (!FINISHED_JOB_STATUSES.has(job.status)) {
      skippedJobs.push({ id: job.id, status: job.status });
      continue;
    }
    migratedJobs.add(job.id);
    rows.jobs.push({
      id: job.id,
      userId,
      threadId: job.threadId,
      teammateId: job.botId,
      kind: (JOB_KINDS.has(job.kind) ? job.kind : "chat") as (typeof runJobs.$inferInsert)["kind"],
      status: job.status as (typeof runJobs.$inferInsert)["status"],
      payload: job.payload,
      result: job.result,
      checkpoint: job.checkpoint,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      idempotencyKey: job.idempotencyKey,
      error: job.error,
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      runAfter: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt ?? job.updatedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  }
  for (const event of source.jobEvents) {
    if (!migratedJobs.has(event.jobId)) continue;
    rows.jobEvents.push({
      id: event.id,
      userId,
      jobId: event.jobId,
      kind: event.kind,
      payload: event.payload,
      sequence: event.sequence,
      createdAt: event.createdAt,
    });
  }
  for (const artifact of source.artifacts) {
    rows.artifacts.push({
      id: artifact.id,
      userId,
      jobId: artifact.jobId && migratedJobs.has(artifact.jobId) ? artifact.jobId : null,
      threadId: artifact.threadId,
      teammateId: artifact.botId,
      path: artifact.path,
      objectKey: legacyWorkspaceObjectKey(source.user.id, artifact.path),
      title: artifact.title,
      mimeType: artifact.mimeType,
      sizeBytes: null,
      description: artifact.description,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
    });
  }
  for (const workspace of source.browserWorkspaces) {
    if (!migratedJobs.has(workspace.jobId)) {
      skipped.push({
        table: "run_browser_workspaces",
        id: workspace.id,
        reason: "job not migrated",
      });
      continue;
    }
    rows.browserWorkspaces.push({
      id: workspace.id,
      userId,
      jobId: workspace.jobId,
      teammateId: workspace.botId,
      pageKey: workspace.pageKey,
      status: "idle",
      url: workspace.url,
      title: workspace.title,
      takeoverJobId: null,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    });
  }
  for (const connection of source.mcpConnections) {
    rows.mcpConnections.push({
      id: connection.id,
      userId,
      name: connection.name,
      url: connection.url,
      transport: connection.transport === "sse" ? "sse" : "streamable-http",
      authSecret: reencrypt(connection.authSecret, keys, secrets),
      oauth: reencrypt(connection.oauth, keys, secrets),
      catalogId: connection.catalogId,
      headers: Object.fromEntries(
        Object.entries(connection.headers).map(([name, value]) => [
          name,
          reencrypt(value, keys, secrets) ?? "",
        ]),
      ),
      enabled: connection.enabled,
      lastTestAt: connection.lastTestAt,
      lastError: connection.lastError,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    });
  }
  for (const explanation of source.mcpExplanations)
    rows.mcpExplanations.push({ ...explanation, userId });
  for (const notification of source.notifications) {
    if (!NOTIFICATION_KINDS.has(notification.kind)) {
      skipped.push({
        table: "run_notifications",
        id: notification.id,
        reason: `unknown kind ${notification.kind}`,
      });
      continue;
    }
    rows.notifications.push({
      ...notification,
      userId,
      kind: notification.kind as (typeof runNotifications.$inferInsert)["kind"],
    });
  }
  if (source.discordLink)
    rows.discordLinks.push({
      userId,
      discordUserId: source.discordLink.discordUserId,
      discordUsername: source.discordLink.discordUsername,
      teammateId: source.discordLink.botId,
      locale: source.discordLink.locale,
      createdAt: source.discordLink.createdAt,
    });
  for (const code of source.discordLinkCodes) {
    if (code.expiresAt.getTime() <= now.getTime()) {
      skipped.push({
        table: "run_discord_link_codes",
        id: code.codeHash.slice(0, 8),
        reason: "expired",
      });
      continue;
    }
    rows.discordLinkCodes.push({ ...code, userId });
  }

  return {
    runUserId: source.user.id,
    deniUserId,
    rows,
    skipped,
    skippedJobs,
    reencryptedSecrets: secrets.n,
    ignoredFields,
  };
}
