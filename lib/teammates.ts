import "@tanstack/react-start/server-only";

import { validAvatarIcon } from "./avatar";
import { createId, nowIso } from "./ids";
import { mutateStore } from "./store";
import type { Bot, Thread } from "./types";
import { assertCanCreateTeammate, isUsageLimitError, type UsageLimitError } from "./usage";

/**
 * Creating, editing, and deleting teammates, shared by the web routes and the Discord bot so
 * both follow the same plan limit and rules.
 */

/** The seeded teammates. Every workspace keeps them, so they cannot be deleted. */
export const DEFAULT_TEAMMATE_IDS: readonly string[] = ["chief", "research", "ops"];

const ACCENTS = ["#d4a574", "#8fad86", "#7f9bb8", "#c97b7b", "#c4b36a", "#b08bb8"];

export type TeammateInput = {
  name?: string;
  job?: string;
  instructions?: string;
  icon?: string | null;
};

export type CreateTeammateResult =
  | { ok: true; bot: Bot; thread: Thread }
  | { ok: false; reason: "invalid_icon" }
  | { ok: false; reason: "name_required" }
  | { ok: false; reason: "limit"; error: UsageLimitError };

export type UpdateTeammateResult = { ok: true; bot: Bot } | { ok: false; reason: "invalid_icon" | "not_found" };

export function isDefaultTeammate(id: string) {
  return DEFAULT_TEAMMATE_IDS.includes(id);
}

/** A new teammate and its DM, within the plan's teammate limit. */
export async function createTeammate(userId: string, input: TeammateInput): Promise<CreateTeammateResult> {
  const name = input.name?.trim();
  if (input.icon !== undefined && !validAvatarIcon(input.icon)) return { ok: false, reason: "invalid_icon" };
  if (!name) return { ok: false, reason: "name_required" };
  try {
    await assertCanCreateTeammate(userId);
  } catch (error) {
    if (isUsageLimitError(error)) return { ok: false, reason: "limit", error };
    throw error;
  }
  const at = nowIso();
  const bot: Bot = {
    id: createId("bot"),
    name,
    icon: input.icon || null,
    job: input.job?.trim() || "Teammate",
    instructions:
      input.instructions?.trim() ||
      `You are Deni Run's teammate "${name}". Complete the assigned work on the computer.`,
    accent: ACCENTS[Math.floor(Math.random() * ACCENTS.length)],
    createdAt: at,
    updatedAt: at,
    memory: [],
  };
  const thread: Thread = {
    id: `dm_${bot.id}`,
    kind: "dm",
    title: bot.name,
    botIds: [bot.id],
    createdAt: at,
    updatedAt: at,
    lastPreview: "Send me a task",
    pinned: false,
    unread: false,
    hidden: false,
    section: null,
  };
  await mutateStore(userId, (store) => {
    store.bots.push(bot);
    store.threads.push(thread);
  });
  return { ok: true, bot, thread };
}

/** Empty fields keep their current value. A rename also renames the teammate's DM. */
export async function updateTeammate(userId: string, id: string, input: TeammateInput): Promise<UpdateTeammateResult> {
  if (input.icon !== undefined && !validAvatarIcon(input.icon)) return { ok: false, reason: "invalid_icon" };
  const bot = await mutateStore(userId, (store) => {
    const item = store.bots.find((entry) => entry.id === id);
    if (!item) return null;
    if (input.name) item.name = input.name.trim();
    if (input.job) item.job = input.job.trim();
    if (input.instructions) item.instructions = input.instructions;
    if (input.icon !== undefined) item.icon = input.icon || null;
    item.updatedAt = nowIso();
    const dm = store.threads.find((thread) => thread.kind === "dm" && thread.botIds[0] === id);
    if (dm) dm.title = item.name;
    return item;
  });
  return bot ? { ok: true, bot } : { ok: false, reason: "not_found" };
}

/** Removes the teammate with every conversation it is part of, groups included, and its routines. */
export async function deleteTeammate(userId: string, id: string): Promise<{ ok: true; deleted: boolean } | { ok: false; reason: "default" }> {
  if (isDefaultTeammate(id)) return { ok: false, reason: "default" };
  const deleted = await mutateStore(userId, (store) => {
    const before = store.bots.length;
    store.bots = store.bots.filter((item) => item.id !== id);
    store.threads = store.threads.filter((item) => !item.botIds.includes(id));
    store.routines = store.routines.filter((item) => item.botId !== id);
    return store.bots.length < before;
  });
  return { ok: true, deleted };
}

/** Drops the chosen memory entries. Ids that are not this teammate's own entries are ignored. */
export async function forgetTeammateMemory(
  userId: string,
  id: string,
  entryIds: readonly string[],
): Promise<{ ok: true; bot: Bot; removed: number } | { ok: false; reason: "not_found" }> {
  const wanted = new Set(entryIds);
  return mutateStore(userId, (store) => {
    const bot = store.bots.find((item) => item.id === id);
    if (!bot) return { ok: false as const, reason: "not_found" as const };
    const before = bot.memory.length;
    bot.memory = bot.memory.filter((entry) => !wanted.has(entry.id));
    const removed = before - bot.memory.length;
    if (removed) bot.updatedAt = nowIso();
    return { ok: true as const, bot, removed };
  });
}
