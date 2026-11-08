import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { UIMessage } from "ai";
import {
  runArtifacts,
  runBrowserWorkspaces,
  runJobs,
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
import { db, type RunDatabase } from "../runtime";
import { DENI_MODEL_ID, parseRunMode } from "../agent/model";
import { emptyStore } from "./seed";
import { nowIso } from "./ids";
import type {
  Bot,
  ComputerState,
  HandoffSnapshot,
  HistorySummary,
  Routine,
  ShellRecord,
  Skill,
  Store,
  Thread,
} from "../types";
import { mergeStoredMessages, normalizeMessageIds } from "../chat/messages";
import { emitComputer } from "../computer/events";
import { withoutBubbleBreaks } from "../chat/message-bubbles";

/**
 * Deni Run kept each account in one JSON document. On the platform the same data lives
 * in relational `run_*` tables; this module keeps the document-shaped API
 * (`readStore`, `mutateStore`) the agent runtime is written against. `mutateStore` runs
 * in one transaction holding the user's `run_settings` row lock, loads the document,
 * applies `fn`, and writes back only the rows that changed.
 */

export type RunTransaction = Parameters<Parameters<RunDatabase["transaction"]>[0]>[0];
type Queryable = RunDatabase | RunTransaction;

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);
const date = (value: string | null | undefined) => (value ? new Date(value) : null);

/** Create the settings row and the seed teammates, DMs and skill on first use. */
async function ensureSeeded(database: Queryable, userId: string) {
  const seed = emptyStore();
  const inserted = await database
    .insert(runSettings)
    .values({ userId, timezone: seed.config.timezone, runMode: "default" })
    .onConflictDoNothing({ target: runSettings.userId })
    .returning({ userId: runSettings.userId });
  if (!inserted.length) return;
  await insertStoreRows(database, userId, seed);
}

/** Insert every teammate, thread, skill and routine of a document (seed and migration). */
export async function insertStoreRows(database: Queryable, userId: string, store: Store) {
  if (store.bots.length) {
    await database
      .insert(runTeammates)
      .values(store.bots.map((bot, index) => teammateRow(userId, bot, index)));
    const memories = store.bots.flatMap((bot) =>
      bot.memory.map((entry) => memoryRow(userId, bot.id, entry)),
    );
    if (memories.length) await database.insert(runTeammateMemories).values(memories);
  }
  if (store.threads.length) {
    await database
      .insert(runThreads)
      .values(
        store.threads.map((thread) =>
          threadRow(userId, thread, store.historySummaries?.[thread.id]),
        ),
      );
    const participants = store.threads.flatMap((thread) =>
      participantRows(userId, thread, store.bots),
    );
    if (participants.length) await database.insert(runThreadParticipants).values(participants);
  }
  if (store.skills.length)
    await database.insert(runSkills).values(store.skills.map((skill) => skillRow(userId, skill)));
  const routines = store.routines.filter((routine) => isLiveRoutine(routine, store));
  if (routines.length)
    await database
      .insert(runRoutines)
      .values(routines.map((routine) => routineRow(userId, routine)));
}

function isLiveRoutine(routine: Routine, store: Store) {
  return (
    store.bots.some((bot) => bot.id === routine.botId) &&
    store.threads.some((thread) => thread.id === routine.threadId)
  );
}

function teammateRow(userId: string, bot: Bot, position: number) {
  return {
    userId,
    id: bot.id,
    name: bot.name,
    job: bot.job,
    instructions: bot.instructions,
    accent: bot.accent,
    icon: bot.icon ?? null,
    tools: bot.tools ?? null,
    computerAccess: bot.computerAccess ?? true,
    position,
    createdAt: new Date(bot.createdAt),
    updatedAt: new Date(bot.updatedAt),
  };
}

function memoryRow(userId: string, teammateId: string, entry: Bot["memory"][number]) {
  return {
    id: `${teammateId}:${entry.id}`,
    userId,
    teammateId,
    text: entry.text,
    createdAt: new Date(entry.createdAt),
  };
}

function threadRow(userId: string, thread: Thread, summary: HistorySummary | undefined) {
  return {
    userId,
    id: thread.id,
    kind: thread.kind,
    title: thread.title,
    icon: thread.icon ?? null,
    lastPreview: thread.lastPreview ?? "",
    pinned: Boolean(thread.pinned),
    unread: Boolean(thread.unread),
    hidden: Boolean(thread.hidden),
    section: thread.section ?? null,
    reactions: thread.reactions ?? {},
    historySummary: summary ?? null,
    createdAt: new Date(thread.createdAt),
    updatedAt: new Date(thread.updatedAt),
  };
}

function participantRows(userId: string, thread: Thread, bots: Bot[]) {
  const known = new Set(bots.map((bot) => bot.id));
  return [...new Set(thread.botIds)]
    .filter((id) => known.has(id))
    .map((teammateId, position) => ({ userId, threadId: thread.id, teammateId, position }));
}

function skillRow(userId: string, skill: Skill) {
  return {
    userId,
    id: skill.id,
    name: skill.name,
    body: skill.body,
    createdAt: new Date(skill.createdAt),
    updatedAt: new Date(skill.updatedAt),
  };
}

function routineRow(userId: string, routine: Routine) {
  return {
    userId,
    id: routine.id,
    teammateId: routine.botId,
    threadId: routine.threadId,
    name: routine.name,
    instructions: routine.instructions,
    cron: routine.cron,
    timezone: routine.timezone,
    enabled: routine.enabled,
    revision: routine.revision ?? 0,
    locale: routine.locale ?? null,
    lastRunAt: date(routine.lastRunAt),
    nextRunAt: date(routine.nextRunAt),
    lastError: routine.lastError,
    createdAt: new Date(routine.createdAt),
    updatedAt: new Date(),
  };
}

async function loadStore(database: Queryable, userId: string, lock: boolean): Promise<Store> {
  await ensureSeeded(database, userId);
  const settingsQuery = database.select().from(runSettings).where(eq(runSettings.userId, userId));
  const [settings] = lock ? await settingsQuery.for("update") : await settingsQuery;
  const teammates = await database
    .select()
    .from(runTeammates)
    .where(eq(runTeammates.userId, userId))
    .orderBy(asc(runTeammates.position), asc(runTeammates.createdAt));
  const memories = await database
    .select()
    .from(runTeammateMemories)
    .where(eq(runTeammateMemories.userId, userId))
    .orderBy(asc(runTeammateMemories.createdAt));
  const threads = await database
    .select()
    .from(runThreads)
    .where(eq(runThreads.userId, userId))
    .orderBy(asc(runThreads.createdAt));
  const participants = await database
    .select()
    .from(runThreadParticipants)
    .where(eq(runThreadParticipants.userId, userId))
    .orderBy(asc(runThreadParticipants.position));
  const skills = await database
    .select()
    .from(runSkills)
    .where(eq(runSkills.userId, userId))
    .orderBy(asc(runSkills.createdAt));
  const routines = await database
    .select()
    .from(runRoutines)
    .where(eq(runRoutines.userId, userId))
    .orderBy(asc(runRoutines.createdAt));
  const historySummaries: Record<string, HistorySummary> = {};
  for (const thread of threads)
    if (thread.historySummary) historySummaries[thread.id] = thread.historySummary;
  const computer = {
    ...emptyStore().computer,
    ...(settings?.computer as Partial<ComputerState> | null),
  };
  const store: Store = {
    version: 1,
    config: {
      apiKey: settings?.openrouterApiKey ?? "",
      timezone: settings?.timezone ?? "UTC",
      model: settings?.model ?? DENI_MODEL_ID,
      runMode: parseRunMode(settings?.runMode),
    },
    bots: teammates.map((row) => ({
      id: row.id,
      name: row.name,
      job: row.job,
      instructions: row.instructions,
      accent: row.accent,
      icon: row.icon,
      tools: row.tools ?? null,
      computerAccess: row.computerAccess,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      memory: memories
        .filter((memory) => memory.teammateId === row.id)
        .map((memory) => ({
          id: memory.id.startsWith(`${row.id}:`) ? memory.id.slice(row.id.length + 1) : memory.id,
          text: memory.text,
          createdAt: memory.createdAt.toISOString(),
        })),
    })),
    threads: threads.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      icon: row.icon,
      reactions: row.reactions,
      botIds: participants
        .filter((item) => item.threadId === row.id)
        .map((item) => item.teammateId),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastPreview: row.lastPreview,
      pinned: row.pinned,
      unread: row.unread,
      hidden: row.hidden,
      section: row.section,
    })),
    skills: skills.map((row) => ({
      id: row.id,
      name: row.name,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    routines: routines.map((row) => ({
      id: row.id,
      botId: row.teammateId,
      threadId: row.threadId,
      name: row.name,
      instructions: row.instructions,
      cron: row.cron,
      timezone: row.timezone,
      enabled: row.enabled,
      revision: row.revision,
      locale: row.locale ?? undefined,
      lastRunAt: iso(row.lastRunAt),
      nextRunAt: iso(row.nextRunAt),
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
    })),
    computer,
    shells: (settings?.shells as ShellRecord[] | undefined) ?? [],
    handoffs: (settings?.handoffs as HandoffSnapshot[] | undefined) ?? [],
    pluginAlwaysAllow: settings?.pluginAlwaysAllow ?? {},
    mcpAlwaysAllow: settings?.mcpAlwaysAllow ?? {},
    historySummaries,
    discord: {
      threadId: settings?.discordThreadId ?? null,
      notify: settings?.discordNotify ?? true,
    },
  };
  normalizeStore(store);
  return store;
}

function normalizeStore(store: Store) {
  store.config.model = DENI_MODEL_ID;
  store.config.runMode = parseRunMode(store.config.runMode);
  store.shells ??= [];
  store.handoffs ??= [];
  store.computer.e2bSandboxId ??= null;
  store.computer.steelSessionId ??= null;
  store.computer.steelProfileId ??= null;
  store.computer.steelDebugUrl ??= null;
  store.computer.activeJobId ??= null;
  store.computer.workspaces ??= {};
  store.computer.activity ??= [];
  if (store.historySummaries) {
    const live = new Set(store.threads.map((thread) => thread.id));
    for (const id of Object.keys(store.historySummaries))
      if (!live.has(id)) delete store.historySummaries[id];
  }
  for (const thread of store.threads) {
    thread.pinned ??= false;
    thread.unread ??= false;
    thread.hidden ??= false;
    thread.section ??= null;
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function byId<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]));
}

type Json = Record<string, unknown>;

/** Write the rows that differ between two versions of a user's document. */
async function writeChanges(database: Queryable, userId: string, before: Store, after: Store) {
  after.computer.activity = after.computer.activity.slice(0, 40);
  const settingsPatch: Partial<typeof runSettings.$inferInsert> = {};
  if (after.config.apiKey !== before.config.apiKey)
    settingsPatch.openrouterApiKey = after.config.apiKey || null;
  if (after.config.timezone !== before.config.timezone)
    settingsPatch.timezone = after.config.timezone;
  if (after.config.runMode !== before.config.runMode)
    settingsPatch.runMode = after.config.runMode ?? null;
  if (!same(after.computer, before.computer))
    settingsPatch.computer = after.computer as unknown as Json;
  if (!same(after.shells, before.shells)) settingsPatch.shells = after.shells as unknown as Json[];
  if (!same(after.handoffs, before.handoffs))
    settingsPatch.handoffs = (after.handoffs ?? []) as unknown as Json[];
  if (!same(after.pluginAlwaysAllow, before.pluginAlwaysAllow))
    settingsPatch.pluginAlwaysAllow = after.pluginAlwaysAllow ?? {};
  if (!same(after.mcpAlwaysAllow, before.mcpAlwaysAllow))
    settingsPatch.mcpAlwaysAllow = after.mcpAlwaysAllow ?? {};
  if (!same(after.discord, before.discord)) {
    settingsPatch.discordThreadId = after.discord?.threadId ?? null;
    settingsPatch.discordNotify = after.discord?.notify !== false;
  }
  if (Object.keys(settingsPatch).length) {
    await database
      .update(runSettings)
      .set({ ...settingsPatch, updatedAt: new Date() })
      .where(eq(runSettings.userId, userId));
  }

  // Removals first (routines and threads reference teammates), then upserts in FK order.
  const afterRoutines = after.routines.filter((routine) => isLiveRoutine(routine, after));
  const removedRoutines = before.routines
    .filter((item) => !afterRoutines.some((next) => next.id === item.id))
    .map((item) => item.id);
  if (removedRoutines.length)
    await database
      .delete(runRoutines)
      .where(and(eq(runRoutines.userId, userId), inArray(runRoutines.id, removedRoutines)));
  const removedThreads = before.threads
    .filter((item) => !after.threads.some((next) => next.id === item.id))
    .map((item) => item.id);
  if (removedThreads.length)
    await database
      .delete(runThreads)
      .where(and(eq(runThreads.userId, userId), inArray(runThreads.id, removedThreads)));
  const removedBots = before.bots
    .filter((item) => !after.bots.some((next) => next.id === item.id))
    .map((item) => item.id);
  if (removedBots.length)
    await database
      .delete(runTeammates)
      .where(and(eq(runTeammates.userId, userId), inArray(runTeammates.id, removedBots)));
  const removedSkills = before.skills
    .filter((item) => !after.skills.some((next) => next.id === item.id))
    .map((item) => item.id);
  if (removedSkills.length)
    await database
      .delete(runSkills)
      .where(and(eq(runSkills.userId, userId), inArray(runSkills.id, removedSkills)));

  const previousBots = byId(before.bots);
  for (const [index, bot] of after.bots.entries()) {
    const previous = previousBots.get(bot.id);
    const previousIndex = before.bots.findIndex((item) => item.id === bot.id);
    const {
      userId: _user,
      id: _id,
      createdAt: _created,
      ...patch
    } = teammateRow(userId, bot, index);
    if (!previous) {
      await database.insert(runTeammates).values(teammateRow(userId, bot, index));
    } else if (
      !same({ ...previous, memory: [] }, { ...bot, memory: [] }) ||
      previousIndex !== index
    ) {
      await database
        .update(runTeammates)
        .set(patch)
        .where(and(eq(runTeammates.userId, userId), eq(runTeammates.id, bot.id)));
    }
    const beforeMemory = byId(previous?.memory ?? []);
    const afterMemory = byId(bot.memory);
    const gone = [...beforeMemory.keys()]
      .filter((id) => !afterMemory.has(id))
      .map((id) => `${bot.id}:${id}`);
    if (gone.length)
      await database
        .delete(runTeammateMemories)
        .where(and(eq(runTeammateMemories.userId, userId), inArray(runTeammateMemories.id, gone)));
    for (const entry of bot.memory) {
      const old = beforeMemory.get(entry.id);
      if (!old)
        await database
          .insert(runTeammateMemories)
          .values(memoryRow(userId, bot.id, entry))
          .onConflictDoNothing();
      else if (old.text !== entry.text)
        await database
          .update(runTeammateMemories)
          .set({ text: entry.text })
          .where(
            and(
              eq(runTeammateMemories.userId, userId),
              eq(runTeammateMemories.id, `${bot.id}:${entry.id}`),
            ),
          );
    }
  }

  const previousThreads = byId(before.threads);
  for (const thread of after.threads) {
    const previous = previousThreads.get(thread.id);
    const summary = after.historySummaries?.[thread.id];
    const {
      userId: _user,
      id: _id,
      createdAt: _created,
      ...patch
    } = threadRow(userId, thread, summary);
    if (!previous) {
      await database.insert(runThreads).values(threadRow(userId, thread, summary));
    } else if (
      !same({ ...previous, botIds: [] }, { ...thread, botIds: [] }) ||
      !same(before.historySummaries?.[thread.id], summary)
    ) {
      await database
        .update(runThreads)
        .set(patch)
        .where(and(eq(runThreads.userId, userId), eq(runThreads.id, thread.id)));
    }
    if (!previous || !same(previous.botIds, thread.botIds)) {
      if (previous)
        await database
          .delete(runThreadParticipants)
          .where(
            and(
              eq(runThreadParticipants.userId, userId),
              eq(runThreadParticipants.threadId, thread.id),
            ),
          );
      const rows = participantRows(userId, thread, after.bots);
      if (rows.length) await database.insert(runThreadParticipants).values(rows);
    }
  }

  const previousSkills = byId(before.skills);
  for (const skill of after.skills) {
    const previous = previousSkills.get(skill.id);
    if (!previous) await database.insert(runSkills).values(skillRow(userId, skill));
    else if (!same(previous, skill))
      await database
        .update(runSkills)
        .set({ name: skill.name, body: skill.body, updatedAt: new Date(skill.updatedAt) })
        .where(and(eq(runSkills.userId, userId), eq(runSkills.id, skill.id)));
  }

  const previousRoutines = byId(before.routines);
  for (const routine of afterRoutines) {
    const previous = previousRoutines.get(routine.id);
    const { userId: _user, id: _id, createdAt: _created, ...patch } = routineRow(userId, routine);
    if (!previous) await database.insert(runRoutines).values(routineRow(userId, routine));
    else if (!same(previous, routine))
      await database
        .update(runRoutines)
        .set(patch)
        .where(and(eq(runRoutines.userId, userId), eq(runRoutines.id, routine.id)));
  }
}

/** Users with an enabled routine whose next run is due. */
export async function listDueRoutineUserIds(at = new Date()) {
  const rows = await db
    .selectDistinct({ userId: runRoutines.userId })
    .from(runRoutines)
    .where(
      and(
        eq(runRoutines.enabled, true),
        sql`${runRoutines.nextRunAt} <= ${at.toISOString()}::timestamptz`,
      ),
    );
  return rows.map((row) => row.userId);
}

export async function readStore(userId: string): Promise<Store> {
  return loadStore(db, userId, false);
}

/**
 * Read-modify-write of the user's Run data in one transaction that holds the user's
 * `run_settings` row lock, so concurrent writers (the web app and the worker) queue up
 * instead of overwriting each other. `fn` runs once.
 */
export async function mutateStore<T>(
  userId: string,
  fn: (store: Store) => T | Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const before = await loadStore(tx, userId, true);
    const store = structuredClone(before);
    const result = await fn(store);
    normalizeStore(store);
    await writeChanges(tx, userId, before, store);
    return result;
  });
}

function validateThreadId(threadId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(threadId)) throw new Error("invalid thread id");
}

function toMessage(row: typeof runMessages.$inferSelect): UIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: row.parts as unknown as UIMessage["parts"],
    ...(row.metadata ? { metadata: row.metadata } : {}),
  } as UIMessage;
}

async function selectMessages(database: Queryable, userId: string, threadId: string) {
  const rows = await database
    .select()
    .from(runMessages)
    .where(and(eq(runMessages.userId, userId), eq(runMessages.threadId, threadId)))
    .orderBy(asc(runMessages.seq));
  return rows.map(toMessage);
}

export async function loadMessages(
  userId: string,
  threadId: string,
  _options?: { clone?: boolean },
): Promise<UIMessage[]> {
  validateThreadId(threadId);
  return normalizeMessageIds(await selectMessages(db, userId, threadId));
}

/**
 * Upsert messages into a thread (one row each). Existing messages keep their position;
 * new ones are appended in order. The thread row is locked while merging so concurrent
 * savers (the stream and a job) cannot interleave.
 */
export async function saveMessages(userId: string, threadId: string, messages: UIMessage[]) {
  validateThreadId(threadId);
  const merged = await db.transaction(async (tx) => {
    const [thread] = await tx
      .select({ id: runThreads.id })
      .from(runThreads)
      .where(and(eq(runThreads.userId, userId), eq(runThreads.id, threadId)))
      .for("update");
    if (!thread) throw new Error("Conversation no longer exists");
    const persisted = await selectMessages(tx, userId, threadId);
    const next = mergeStoredMessages(persisted, messages);
    const previous = new Map(persisted.map((message) => [message.id, message]));
    const keep = new Set(next.map((message) => message.id));
    const dropped = persisted
      .filter((message) => !keep.has(message.id))
      .map((message) => message.id);
    if (dropped.length)
      await tx
        .delete(runMessages)
        .where(
          and(
            eq(runMessages.userId, userId),
            eq(runMessages.threadId, threadId),
            inArray(runMessages.id, dropped),
          ),
        );
    const now = new Date();
    for (const message of next) {
      const old = previous.get(message.id);
      if (old && same(old, message)) continue;
      const values = {
        role: message.role,
        parts: message.parts as unknown as Json[],
        metadata: (message.metadata as Json | undefined) ?? null,
        updatedAt: now,
      };
      if (old)
        await tx
          .update(runMessages)
          .set(values)
          .where(
            and(
              eq(runMessages.userId, userId),
              eq(runMessages.threadId, threadId),
              eq(runMessages.id, message.id),
            ),
          );
      else
        await tx
          .insert(runMessages)
          .values({ userId, threadId, id: message.id, ...values, createdAt: now });
    }
    return next;
  });
  await touchThreadPreview(userId, threadId, lastText(merged));
}

function lastText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i]?.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j] as { type?: string; text?: string };
      if (part?.type === "text" && part.text?.trim()) return withoutBubbleBreaks(part.text).trim();
    }
  }
  return "";
}

export async function ensureThread(userId: string, threadId: string): Promise<Thread> {
  const store = await readStore(userId);
  const existing = store.threads.find((item) => item.id === threadId);
  if (existing) return existing;
  throw new Error("thread not found");
}

/** Remove a thread's job records (events cascade), notifications, pages and deliverables. */
async function deleteThreadRecords(tx: RunTransaction, userId: string, threadId: string) {
  const jobs = await tx
    .select({ id: runJobs.id })
    .from(runJobs)
    .where(and(eq(runJobs.userId, userId), eq(runJobs.threadId, threadId)));
  const jobIds = jobs.map((job) => job.id);
  if (jobIds.length) {
    await tx
      .delete(runNotifications)
      .where(and(eq(runNotifications.userId, userId), inArray(runNotifications.jobId, jobIds)));
    await tx
      .delete(runBrowserWorkspaces)
      .where(
        and(eq(runBrowserWorkspaces.userId, userId), inArray(runBrowserWorkspaces.jobId, jobIds)),
      );
  }
  await tx
    .delete(runArtifacts)
    .where(and(eq(runArtifacts.userId, userId), eq(runArtifacts.threadId, threadId)));
  await tx.delete(runJobs).where(and(eq(runJobs.userId, userId), eq(runJobs.threadId, threadId)));
  await tx
    .delete(runMessages)
    .where(and(eq(runMessages.userId, userId), eq(runMessages.threadId, threadId)));
  return jobIds;
}

export async function deleteGroupThread(userId: string, threadId: string): Promise<boolean> {
  const computer = await db.transaction(async (tx) => {
    const before = await loadStore(tx, userId, true);
    if (!before.threads.some((thread) => thread.id === threadId && thread.kind === "group"))
      return null;
    const store = structuredClone(before);
    const jobIds = await deleteThreadRecords(tx, userId, threadId);
    store.threads = store.threads.filter((thread) => thread.id !== threadId);
    store.routines = store.routines.filter((routine) => routine.threadId !== threadId);
    for (const id of jobIds) if (store.computer.workspaces) delete store.computer.workspaces[id];
    if (store.computer.activeJobId && jobIds.includes(store.computer.activeJobId)) {
      store.computer.status = "idle";
      store.computer.activeJobId = null;
      store.computer.workingBotId = null;
      store.computer.workingLabel = "";
    }
    await writeChanges(tx, userId, before, store);
    return store.computer;
  });
  if (computer) emitComputer(userId, computer);
  return Boolean(computer);
}

/**
 * Empty a conversation for good: its messages, reactions, deliverables list, and the records of
 * its tasks. The teammate, its memory, routines, and the files in the workspace stay. Returns
 * false when the conversation does not exist.
 */
export async function clearThreadHistory(userId: string, threadId: string): Promise<boolean> {
  validateThreadId(threadId);
  const computer = await db.transaction(async (tx) => {
    const before = await loadStore(tx, userId, true);
    const store = structuredClone(before);
    const thread = store.threads.find((item) => item.id === threadId);
    if (!thread) return null;
    const jobIds = await deleteThreadRecords(tx, userId, threadId);
    thread.reactions = {};
    thread.lastPreview = "";
    thread.updatedAt = nowIso();
    if (store.historySummaries) delete store.historySummaries[threadId];
    for (const id of jobIds) if (store.computer.workspaces) delete store.computer.workspaces[id];
    await writeChanges(tx, userId, before, store);
    return store.computer;
  });
  if (computer) emitComputer(userId, computer);
  return Boolean(computer);
}

/** Delete every Run row of a user (the account itself stays). */
export async function deleteUserRecords(userId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(runJobs).where(eq(runJobs.userId, userId));
    await tx.delete(runThreads).where(eq(runThreads.userId, userId));
    await tx.delete(runTeammates).where(eq(runTeammates.userId, userId));
    await tx.delete(runSkills).where(eq(runSkills.userId, userId));
    await tx.delete(runSettings).where(eq(runSettings.userId, userId));
    await tx.delete(runNotifications).where(eq(runNotifications.userId, userId));
    await tx.delete(runArtifacts).where(eq(runArtifacts.userId, userId));
    await tx.delete(runBrowserWorkspaces).where(eq(runBrowserWorkspaces.userId, userId));
  });
}

export async function loadAllMessages(userId: string) {
  const store = await readStore(userId);
  return Promise.all(
    store.threads.map(async (thread) => ({
      threadId: thread.id,
      messages: await loadMessages(userId, thread.id),
    })),
  );
}

export async function touchThreadPreview(userId: string, threadId: string, preview: string) {
  await db
    .update(runThreads)
    .set({ lastPreview: preview.slice(0, 140), updatedAt: new Date() })
    .where(and(eq(runThreads.userId, userId), eq(runThreads.id, threadId)));
}
