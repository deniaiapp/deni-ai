import "@tanstack/react-start/server-only";

import { createId, nowIso } from "../data/ids";
import { mutateStore } from "../data/store";
import type { Bot, Store, Thread } from "../types";

/**
 * Creating and editing group conversations, shared by the web routes and the Discord bot.
 * Deleting a group is deleteGroupThread in src/lib/data/store.ts, since it also removes its jobs.
 */

export const GROUP_TITLE_MAX = 120;

export type GroupInput = { title?: string; botIds: readonly string[]; icon?: string | null };
export type GroupEdits = { title?: string; icon?: string | null; botIds?: readonly string[] };
export type GroupFailure = "not_found" | "not_group" | "invalid_members" | "invalid_title";

// Thrown inside mutateStore so a refused change is never written.
class GroupError extends Error {
  constructor(readonly reason: GroupFailure) {
    super(reason);
  }
}

async function guarded<T>(work: () => Promise<T>): Promise<T | { ok: false; reason: GroupFailure }> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof GroupError) return { ok: false, reason: error.reason };
    throw error;
  }
}

/** A group of at least two of the user's teammates. Ids that are not theirs are dropped. */
export async function createGroup(userId: string, input: GroupInput): Promise<{ ok: true; thread: Thread } | { ok: false; reason: GroupFailure }> {
  const id = createId("grp");
  const at = nowIso();
  return guarded(async () => {
    const thread = await mutateStore(userId, (store) => {
      const botIds = [...new Set(input.botIds)].filter((botId) => store.bots.some((bot) => bot.id === botId));
      if (botIds.length < 2) throw new GroupError("invalid_members");
      const created: Thread = {
        id,
        kind: "group",
        icon: input.icon || null,
        title:
          input.title?.trim().slice(0, GROUP_TITLE_MAX) ||
          botIds
            .map((botId) => store.bots.find((bot) => bot.id === botId)?.name)
            .filter(Boolean)
            .join(" · ")
            .slice(0, GROUP_TITLE_MAX),
        botIds,
        createdAt: at,
        updatedAt: at,
        lastPreview: "Group started",
        pinned: false,
        unread: false,
        hidden: false,
        section: null,
      };
      store.threads.push(created);
      return created;
    });
    return { ok: true as const, thread };
  });
}

/**
 * Applies title, icon, and member changes to a thread inside the caller's mutateStore. It checks
 * everything before changing anything, so a refusal leaves the store as it was. Routines of
 * teammates who leave the group are turned off, since they would run in a group without them.
 */
export function applyGroupEdits(
  store: Store,
  thread: Thread,
  edits: GroupEdits,
): { ok: true; disabledRoutines: number } | { ok: false; reason: "not_group" | "invalid_members" } {
  if (edits.title === undefined && edits.icon === undefined && edits.botIds === undefined) return { ok: true, disabledRoutines: 0 };
  if (thread.kind !== "group") return { ok: false, reason: "not_group" };
  const ids = edits.botIds && [...new Set(edits.botIds)];
  if (ids && (ids.length < 2 || ids.some((id) => !store.bots.some((bot) => bot.id === id)))) return { ok: false, reason: "invalid_members" };
  if (edits.title !== undefined) thread.title = edits.title;
  if (edits.icon !== undefined) thread.icon = edits.icon || null;
  let disabledRoutines = 0;
  if (ids) {
    thread.botIds = ids;
    for (const routine of store.routines) {
      if (routine.threadId !== thread.id || ids.includes(routine.botId)) continue;
      if (routine.enabled) disabledRoutines++;
      routine.enabled = false;
      routine.nextRunAt = null;
      routine.revision = (routine.revision ?? 0) + 1;
    }
  }
  return { ok: true, disabledRoutines };
}

/** Rename a group or replace its members. Only groups can be edited this way; DMs follow their teammate. */
export async function updateGroup(
  userId: string,
  groupId: string,
  edits: { title?: string; botIds?: readonly string[] },
): Promise<{ ok: true; thread: Thread; disabledRoutines: number } | { ok: false; reason: GroupFailure }> {
  const title = edits.title?.trim();
  if (edits.title !== undefined && (!title || title.length > GROUP_TITLE_MAX)) return { ok: false, reason: "invalid_title" };
  return guarded(() =>
    mutateStore(userId, (store) => {
      const thread = store.threads.find((item) => item.id === groupId && item.kind === "group");
      if (!thread) throw new GroupError("not_found");
      const edited = applyGroupEdits(store, thread, { title, botIds: edits.botIds });
      if (!edited.ok) throw new GroupError(edited.reason);
      thread.updatedAt = nowIso();
      return { ok: true as const, thread, disabledRoutines: edited.disabledRoutines };
    }),
  );
}

export function listGroups(store: Store) {
  return store.threads.filter((thread) => thread.kind === "group");
}

/** The teammates in a group, in the group's order. */
export function groupMembers(store: Store, thread: Thread): Bot[] {
  return thread.botIds.flatMap((id) => store.bots.filter((bot) => bot.id === id));
}

/**
 * The group plain Discord DMs go to: the one chosen with /group talk, if it still exists and
 * has members. Mirrors the routing in src/lib/discord/turn.ts.
 */
export function discordTargetGroup(store: Store) {
  const threadId = store.discord?.threadId;
  const thread = threadId ? store.threads.find((item) => item.id === threadId && item.kind === "group") : undefined;
  return thread && groupMembers(store, thread).length ? thread : null;
}
