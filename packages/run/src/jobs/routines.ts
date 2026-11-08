import "@tanstack/react-start/server-only";

import { z } from "zod";
import { nextCron } from "./cron";
import { createId, nowIso } from "../data/ids";
import { mutateStore } from "../data/store";
import type { Routine } from "../types";

export const ROUTINE_NAME_MAX = 120;
export const ROUTINE_INSTRUCTIONS_MAX = 20_000;
export const ROUTINE_CRON_MAX = 160;

const id = z.string().trim().min(1).max(200);
const fields = z.object({
  name: z.string().trim().min(1, "Name is required.").max(ROUTINE_NAME_MAX),
  instructions: z.string().trim().min(1, "Instruction is required.").max(ROUTINE_INSTRUCTIONS_MAX),
  cron: z.string().trim().min(1, "When to run is required.").max(ROUTINE_CRON_MAX),
  timezone: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});
const createSchema = fields.extend({ botId: id, threadId: id });
const updateSchema = fields.partial().extend({ id });

export type CreateRoutineInput = z.input<typeof createSchema>;
export type UpdateRoutineInput = z.input<typeof updateSchema>;
/** field is the first invalid field (name, instructions, cron, ...), so callers can say which one. */
export type RoutineResult = { ok: true; routine: Routine } | { ok: false; reason: "invalid"; field: string } | { ok: false; reason: "not_found" };

function invalid(error: z.ZodError): RoutineResult {
  return { ok: false, reason: "invalid", field: String(error.issues[0]?.path[0]) };
}

/**
 * Schedule recurring work. The teammate must be a member of the conversation the routine posts
 * to. Throws the English cron errors (invalid expression or timezone) before anything is saved.
 * locale is the language background runs write in.
 */
export async function createRoutine(userId: string, input: CreateRoutineInput, locale: string): Promise<RoutineResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  const routine = await mutateStore(userId, (store) => {
    const thread = store.threads.find((entry) => entry.id === data.threadId);
    if (!store.bots.some((bot) => bot.id === data.botId) || !thread?.botIds.includes(data.botId)) return null;
    const timezone = data.timezone ?? store.config.timezone;
    const nextRunAt = nextCron(data.cron, timezone);
    const enabled = data.enabled ?? true;
    const item: Routine = { id: createId("rtn"), botId: data.botId, threadId: data.threadId, name: data.name, instructions: data.instructions, cron: data.cron, timezone, enabled, revision: 0, lastRunAt: null, nextRunAt: enabled ? nextRunAt : null, lastError: null, createdAt: nowIso(), locale };
    store.routines.push(item);
    return item;
  });
  return routine ? { ok: true, routine } : { ok: false, reason: "not_found" };
}

/**
 * Change any of a routine's fields. A real change bumps the revision, so a run scheduled from the
 * old version is skipped, and clears the last error. Throws the English cron errors.
 */
export async function updateRoutine(userId: string, input: UpdateRoutineInput, locale: string): Promise<RoutineResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  const routine = await mutateStore(userId, (store) => {
    const item = store.routines.find((entry) => entry.id === data.id);
    if (!item) return null;
    const cron = data.cron ?? item.cron;
    const timezone = data.timezone ?? item.timezone ?? store.config.timezone;
    const enabled = data.enabled ?? item.enabled;
    const scheduleChanged = cron !== item.cron || timezone !== item.timezone || enabled !== item.enabled;
    // Validate edits even when disabled, but allow an invalid legacy routine to be switched off.
    const nextRunAt = data.cron !== undefined || data.timezone !== undefined || (enabled && scheduleChanged) ? nextCron(cron, timezone) : item.nextRunAt;
    const changed = scheduleChanged || (data.name !== undefined && data.name !== item.name) || (data.instructions !== undefined && data.instructions !== item.instructions);
    item.name = data.name ?? item.name;
    item.instructions = data.instructions ?? item.instructions;
    item.cron = cron;
    item.timezone = timezone;
    item.enabled = enabled;
    item.locale = locale;
    item.nextRunAt = enabled ? (scheduleChanged || !item.nextRunAt ? nextRunAt ?? nextCron(cron, timezone) : item.nextRunAt) : null;
    if (changed) { item.revision = (item.revision ?? 0) + 1; item.lastError = null; }
    return item;
  });
  return routine ? { ok: true, routine } : { ok: false, reason: "not_found" };
}

/** Remove one of the user's routines. Returns what was removed, or null when the id is not theirs. */
export async function deleteRoutine(userId: string, routineId: string): Promise<Routine | null> {
  return mutateStore(userId, (store) => {
    const index = store.routines.findIndex((item) => item.id === routineId);
    if (index < 0) return null;
    return store.routines.splice(index, 1)[0] ?? null;
  });
}

/**
 * The canonical IANA name ("asia/tokyo" becomes "Asia/Tokyo"), or null when Intl does not know it.
 * Offsets such as "+09:00" are refused: they ignore daylight saving, and the web app lists names.
 */
export function normalizeTimezone(value: string): string | null {
  const zone = value.trim();
  if (!zone || zone.length > 100 || !/^[A-Za-z][\w+\-/]*$/.test(zone)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Set the timezone new routines default to. Existing routines keep their own. Null when unknown. */
export async function setDefaultTimezone(userId: string, value: string): Promise<string | null> {
  const timezone = normalizeTimezone(value);
  if (!timezone) return null;
  await mutateStore(userId, (store) => {
    store.config.timezone = timezone;
  });
  return timezone;
}
