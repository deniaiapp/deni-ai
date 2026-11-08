import type { Bot } from "../types";

/**
 * Tool groups a teammate can be given. `files`, `shell` and `browser` use the shared
 * computer and are off when the teammate has no computer access.
 */
export const TEAMMATE_TOOL_GROUPS = [
  "files",
  "shell",
  "browser",
  "web",
  "mcp",
  "memory",
  "skills",
  "routines",
  "handoff",
] as const;

export type TeammateToolGroup = (typeof TEAMMATE_TOOL_GROUPS)[number];

export const COMPUTER_TOOL_GROUPS: readonly TeammateToolGroup[] = ["files", "shell", "browser"];

export function isTeammateToolGroup(value: unknown): value is TeammateToolGroup {
  return typeof value === "string" && (TEAMMATE_TOOL_GROUPS as readonly string[]).includes(value);
}

/** Keep known groups, in canonical order, without duplicates. */
export function normalizeToolGroups(value: unknown): TeammateToolGroup[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const chosen = new Set(value.filter(isTeammateToolGroup));
  return TEAMMATE_TOOL_GROUPS.filter((group) => chosen.has(group));
}

/** The groups a teammate may use: its own list (all when unset), minus the computer without access. */
export function teammateToolGroups(
  bot: Pick<Bot, "tools" | "computerAccess">,
): TeammateToolGroup[] {
  const groups = normalizeToolGroups(bot.tools) ?? [...TEAMMATE_TOOL_GROUPS];
  return bot.computerAccess === false
    ? groups.filter((group) => !COMPUTER_TOOL_GROUPS.includes(group))
    : groups;
}
