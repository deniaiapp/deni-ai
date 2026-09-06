import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { UIMessage } from "ai";
import { db, sqlClient } from "@/db";
import {
  agentJobs,
  appNotifications,
  browserWorkspaces,
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
  const rows = await sqlClient<{ user_id: string }[]>`
    SELECT user_id
    FROM user_stores
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(data->'routines', '[]'::jsonb)) AS r
      WHERE COALESCE((r->>'enabled')::boolean, false)
        AND NULLIF(r->>'nextRunAt', '') IS NOT NULL
        AND (r->>'nextRunAt')::timestamptz <= ${at.toISOString()}::timestamptz
    )
  `;
  return rows.map((row) => row.user_id);
}

export async function findUserIdByStripeCustomer(customerId: string) {
  const rows = await sqlClient<{ user_id: string }[]>`
    SELECT user_id
    FROM user_stores
    WHERE data->'billing'->>'stripeCustomerId' = ${customerId}
    LIMIT 1
  `;
  return rows[0]?.user_id ?? null;
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

export async function mutateStore<T>(
  userId: string,
  fn: (store: Store) => T | Promise<T>,
): Promise<T> {
  return withUserLock(userId, async () => {
    return db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(userStores)
        .where(eq(userStores.userId, userId))
        .for("update");
      let row = rows[0];
      // The row lock serializes updates across processes. Initialize only on the
      // missing-row path rather than reading the same store before every mutation.
      if (!row) {
        await tx.insert(userStores).values({ userId, data: emptyStore() }).onConflictDoNothing({ target: userStores.userId });
        const created = await tx.select().from(userStores).where(eq(userStores.userId, userId)).for("update");
        row = created[0];
      }
      if (!row) throw new Error("user store not found");
      const store = structuredClone(row.data);
      normalizeStore(store);
      const result = await fn(store);
      store.computer.activity = store.computer.activity.slice(0, 40);
      await tx
        .update(userStores)
        .set({ data: store, updatedAt: new Date() })
        .where(eq(userStores.userId, userId));
      return result;
    });
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
  const merged = await db.transaction(async (tx) => {
    const [owner] = await tx.select({ data: userStores.data }).from(userStores).where(eq(userStores.userId, userId)).for("share");
    if (!owner?.data.threads.some((thread) => thread.id === threadId)) throw new Error("Conversation no longer exists");
    await tx.insert(threadMessages).values({ userId, threadId, messages: [], updatedAt: new Date() }).onConflictDoNothing();
    const [row] = await tx.select().from(threadMessages).where(and(eq(threadMessages.userId, userId), eq(threadMessages.threadId, threadId))).for("update");
    const next = mergeStoredMessages(row?.messages ?? [], messages);
    await tx.update(threadMessages).set({ messages: next, updatedAt: new Date() }).where(and(eq(threadMessages.userId, userId), eq(threadMessages.threadId, threadId)));
    return next;
  });
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
  const computer = await withUserLock(userId, () => db.transaction(async (tx) => {
    const [row] = await tx.select().from(userStores).where(eq(userStores.userId, userId)).for("update");
    if (!row?.data.threads.some((thread) => thread.id === threadId && thread.kind === "group")) return null;
    const store = structuredClone(row.data);
    const jobs = await tx.select({ id: agentJobs.id }).from(agentJobs).where(and(eq(agentJobs.userId, userId), eq(agentJobs.threadId, threadId)));
    const jobIds = jobs.map((job) => job.id);
    if (jobIds.length) {
      await tx.delete(jobEvents).where(and(eq(jobEvents.userId, userId), inArray(jobEvents.jobId, jobIds)));
      await tx.delete(appNotifications).where(and(eq(appNotifications.userId, userId), inArray(appNotifications.jobId, jobIds)));
      await tx.delete(browserWorkspaces).where(and(eq(browserWorkspaces.userId, userId), inArray(browserWorkspaces.jobId, jobIds)));
    }
    await tx.delete(jobArtifacts).where(and(eq(jobArtifacts.userId, userId), eq(jobArtifacts.threadId, threadId)));
    await tx.delete(agentJobs).where(and(eq(agentJobs.userId, userId), eq(agentJobs.threadId, threadId)));
    await tx.delete(threadMessages).where(and(eq(threadMessages.userId, userId), eq(threadMessages.threadId, threadId)));
    store.threads = store.threads.filter((thread) => thread.id !== threadId);
    store.routines = store.routines.filter((routine) => routine.threadId !== threadId);
    for (const id of jobIds) if (store.computer.workspaces) delete store.computer.workspaces[id];
    if (store.computer.activeJobId && jobIds.includes(store.computer.activeJobId)) {
      store.computer.status = "idle"; store.computer.activeJobId = null; store.computer.workingBotId = null; store.computer.workingLabel = "";
    }
    await tx.update(userStores).set({ data: store, updatedAt: new Date() }).where(eq(userStores.userId, userId));
    return store.computer;
  }));
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
