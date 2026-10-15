import "@tanstack/react-start/server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { UIMessage } from "ai";
import { db, rawRows } from "@/db";
import {
  agentJobs,
  appNotifications,
  browserWorkspaces,
  discordLinkCodes,
  discordLinks,
  jobArtifacts,
  jobEvents,
  mcpConnections,
  threadMessages,
  userStores,
} from "@/db/schema";
import { DENI_MODEL_ID, parseRunMode } from "./model";
import { emptyStore } from "./seed";
import { nowIso } from "./ids";
import type { Store, Thread } from "./types";
import { mergeStoredMessages, normalizeMessageIds } from "./messages";
import { emitComputer } from "./events";

const g = globalThis as typeof globalThis & {
  __deniStoreLocks?: Map<string, Promise<unknown>>;
};

function storeLocks() {
  if (!g.__deniStoreLocks) g.__deniStoreLocks = new Map();
  return g.__deniStoreLocks;
}

function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const locks = storeLocks();
  const previous = locks.get(userId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(
    userId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

const WRITE_ATTEMPTS = 8;
const backoff = (attempt: number) => new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));

async function ensureUserStore(userId: string) {
  const existing = await db
    .select({ data: userStores.data })
    .from(userStores)
    .where(eq(userStores.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0].data;

  const fresh = emptyStore();
  await db
    .insert(userStores)
    .values({ userId, data: fresh })
    .onConflictDoNothing({ target: userStores.userId });
  const created = await db
    .select({ data: userStores.data })
    .from(userStores)
    .where(eq(userStores.userId, userId))
    .limit(1);
  return created[0]?.data ?? fresh;
}

export async function listUserStores() {
  return db.select({ userId: userStores.userId, data: userStores.data }).from(userStores);
}

export async function listDueRoutineUserIds(at = new Date()) {
  const rows = await rawRows<[string]>(
    `SELECT user_id
     FROM user_stores
     WHERE EXISTS (
       SELECT 1
       FROM json_each(COALESCE(json_extract(data, '$.routines'), '[]')) AS r
       WHERE COALESCE(json_extract(r.value, '$.enabled'), 0) = 1
         AND NULLIF(json_extract(r.value, '$.nextRunAt'), '') IS NOT NULL
         AND julianday(json_extract(r.value, '$.nextRunAt')) <= julianday(?)
     )`,
    [at.toISOString()],
  );
  return rows.map((row) => row[0]);
}

export async function findUserIdByStripeCustomer(customerId: string) {
  const rows = await rawRows<[string]>(
    `SELECT user_id
     FROM user_stores
     WHERE json_extract(data, '$.billing.stripeCustomerId') = ?
     LIMIT 1`,
    [customerId],
  );
  return rows[0]?.[0] ?? null;
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
  store.billing ??= {
    plan: "free",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeStatus: null,
    currentPeriodEnd: null,
  };
  const month = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
  if (!store.usage || store.usage.month !== month) {
    store.usage = { month, tokens: 0, browserMs: 0, computerMs: 0 };
  }
  store.usage.tokens ??= 0;
  store.usage.browserMs ??= 0;
  store.usage.computerMs ??= 0;
  if (store.historySummaries) {
    // Drop summaries of deleted conversations, whichever route deleted them.
    const live = new Set(store.threads.map((thread) => thread.id));
    for (const id of Object.keys(store.historySummaries)) if (!live.has(id)) delete store.historySummaries[id];
  }
  for (const thread of store.threads) {
    thread.pinned ??= false;
    thread.unread ??= false;
    thread.hidden ??= false;
    thread.section ??= null;
  }
}

export async function readStore(userId: string): Promise<Store> {
  const store = await ensureUserStore(userId);
  normalizeStore(store);
  return structuredClone(store);
}

/**
 * Read-modify-write of the user document. D1 has no row locks, so concurrent writers in
 * other processes (the app and the worker) are resolved with a version compare-and-swap:
 * the loser re-reads and re-runs `fn`. `fn` can therefore run more than once and must be
 * safe to repeat.
 */
export async function mutateStore<T>(
  userId: string,
  fn: (store: Store) => T | Promise<T>,
): Promise<T> {
  return withUserLock(userId, async () => {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const [row] = await db
        .select()
        .from(userStores)
        .where(eq(userStores.userId, userId))
        .limit(1);
      if (!row) {
        await db
          .insert(userStores)
          .values({ userId, data: emptyStore() })
          .onConflictDoNothing({ target: userStores.userId });
        continue;
      }
      const store = structuredClone(row.data);
      normalizeStore(store);
      const result = await fn(store);
      store.computer.activity = store.computer.activity.slice(0, 40);
      const written = await db
        .update(userStores)
        .set({ data: store, updatedAt: new Date(), version: row.version + 1 })
        .where(and(eq(userStores.userId, userId), eq(userStores.version, row.version)))
        .returning({ version: userStores.version });
      if (written.length) return result;
      await backoff(attempt);
    }
    throw new Error("The workspace is busy. Please try again.");
  });
}

function validateThreadId(threadId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(threadId)) {
    throw new Error("invalid thread id");
  }
}

export async function loadMessages(
  userId: string,
  threadId: string,
  options?: { clone?: boolean },
): Promise<UIMessage[]> {
  validateThreadId(threadId);
  const rows = await db
    .select({ messages: threadMessages.messages })
    .from(threadMessages)
    .where(and(eq(threadMessages.userId, userId), eq(threadMessages.threadId, threadId)))
    .limit(1);
  const messages = normalizeMessageIds(rows[0]?.messages ?? []);
  return options?.clone === false ? messages : structuredClone(messages);
}

export async function saveMessages(userId: string, threadId: string, messages: UIMessage[]) {
  validateThreadId(threadId);
  const [owner] = await db
    .select({ data: userStores.data })
    .from(userStores)
    .where(eq(userStores.userId, userId));
  if (!owner?.data.threads.some((thread) => thread.id === threadId)) throw new Error("Conversation no longer exists");
  await db
    .insert(threadMessages)
    .values({ userId, threadId, messages: [], updatedAt: new Date() })
    .onConflictDoNothing();
  // updated_at doubles as the version: merge against what was read and commit only if
  // nobody else saved in between, otherwise read and merge again.
  let merged: UIMessage[] | null = null;
  for (let attempt = 0; attempt < WRITE_ATTEMPTS && !merged; attempt++) {
    const [row] = await db
      .select()
      .from(threadMessages)
      .where(and(eq(threadMessages.userId, userId), eq(threadMessages.threadId, threadId)));
    if (!row) throw new Error("Conversation no longer exists");
    const next = mergeStoredMessages(row.messages ?? [], messages);
    const written = await db
      .update(threadMessages)
      .set({ messages: next, updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) })
      .where(
        and(
          eq(threadMessages.userId, userId),
          eq(threadMessages.threadId, threadId),
          eq(threadMessages.updatedAt, row.updatedAt),
        ),
      )
      .returning({ threadId: threadMessages.threadId });
    if (written.length) merged = next;
    else await backoff(attempt);
  }
  if (!merged) throw new Error("The conversation is busy. Please try again.");
  await touchThreadPreview(userId, threadId, lastText(merged));
}

function lastText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i]?.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j] as { type?: string; text?: string };
      if (part?.type === "text" && part.text?.trim()) return part.text.trim();
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

export async function deleteGroupThread(userId: string, threadId: string): Promise<boolean> {
  const computer = await withUserLock(userId, async () => {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const [row] = await db.select().from(userStores).where(eq(userStores.userId, userId));
      if (!row?.data.threads.some((thread) => thread.id === threadId && thread.kind === "group")) return null;
      const store = structuredClone(row.data);
      const jobs = await db
        .select({ id: agentJobs.id })
        .from(agentJobs)
        .where(and(eq(agentJobs.userId, userId), eq(agentJobs.threadId, threadId)));
      const jobIds = jobs.map((job) => job.id);
      store.threads = store.threads.filter((thread) => thread.id !== threadId);
      store.routines = store.routines.filter((routine) => routine.threadId !== threadId);
      for (const id of jobIds) if (store.computer.workspaces) delete store.computer.workspaces[id];
      if (store.computer.activeJobId && jobIds.includes(store.computer.activeJobId)) {
        store.computer.status = "idle"; store.computer.activeJobId = null; store.computer.workingBotId = null; store.computer.workingLabel = "";
      }
      // A batch is one D1 transaction. The first statement is the version guard (it only
      // matches if nobody changed the document since it was read); every delete after it
      // is gated on that write having happened, so a lost race changes nothing.
      const next = row.version + 1;
      const guard = sql`exists (select 1 from user_stores where user_id = ${userId} and version = ${next})`;
      const statements = [
        db
          .update(userStores)
          .set({ data: store, updatedAt: new Date(), version: next })
          .where(and(eq(userStores.userId, userId), eq(userStores.version, row.version))),
        ...(jobIds.length
          ? [
              db.delete(jobEvents).where(and(eq(jobEvents.userId, userId), inArray(jobEvents.jobId, jobIds), guard)),
              db.delete(appNotifications).where(and(eq(appNotifications.userId, userId), inArray(appNotifications.jobId, jobIds), guard)),
              db.delete(browserWorkspaces).where(and(eq(browserWorkspaces.userId, userId), inArray(browserWorkspaces.jobId, jobIds), guard)),
            ]
          : []),
        db.delete(jobArtifacts).where(and(eq(jobArtifacts.userId, userId), eq(jobArtifacts.threadId, threadId), guard)),
        db.delete(agentJobs).where(and(eq(agentJobs.userId, userId), eq(agentJobs.threadId, threadId), guard)),
        db.delete(threadMessages).where(and(eq(threadMessages.userId, userId), eq(threadMessages.threadId, threadId), guard)),
      ];
      await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
      const [after] = await db
        .select({ version: userStores.version })
        .from(userStores)
        .where(eq(userStores.userId, userId));
      if (after?.version === next) return store.computer;
      await backoff(attempt);
    }
    throw new Error("The workspace is busy. Please try again.");
  });
  if (computer) emitComputer(userId, computer);
  return Boolean(computer);
}

export async function deleteUserRecords(userId: string) {
  await db.delete(jobEvents).where(eq(jobEvents.userId, userId));
  await db.delete(agentJobs).where(eq(agentJobs.userId, userId));
  await db.delete(browserWorkspaces).where(eq(browserWorkspaces.userId, userId));
  await db.delete(mcpConnections).where(eq(mcpConnections.userId, userId));
  await db.delete(jobArtifacts).where(eq(jobArtifacts.userId, userId));
  await db.delete(appNotifications).where(eq(appNotifications.userId, userId));
  await db.delete(discordLinkCodes).where(eq(discordLinkCodes.userId, userId));
  await db.delete(discordLinks).where(eq(discordLinks.userId, userId));
  await db.delete(threadMessages).where(eq(threadMessages.userId, userId));
  await db.delete(userStores).where(eq(userStores.userId, userId));
}

export async function loadAllMessages(userId: string) {
  return db
    .select({
      threadId: threadMessages.threadId,
      messages: threadMessages.messages,
    })
    .from(threadMessages)
    .where(eq(threadMessages.userId, userId));
}

export async function touchThreadPreview(userId: string, threadId: string, preview: string) {
  await mutateStore(userId, (store) => {
    const thread = store.threads.find((item) => item.id === threadId);
    if (thread) {
      thread.updatedAt = nowIso();
      thread.lastPreview = preview.slice(0, 140);
    }
  });
}
