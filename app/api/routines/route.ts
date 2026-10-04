import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { nextCron } from "@/lib/cron";
import { createId, nowIso } from "@/lib/ids";
import { mutateStore, readStore } from "@/lib/store";
import { getExtracted } from "next-intl/server";
import { localizeError } from "@/lib/localize-error";

export const dynamic = "force-dynamic";
const id = z.string().trim().min(1).max(200);
const fields = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  instructions: z.string().trim().min(1, "Instruction is required.").max(20000),
  cron: z.string().trim().min(1, "When to run is required.").max(160),
  timezone: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});
const createSchema = fields.extend({ botId: id, threadId: id });
const updateSchema = fields.partial().extend({ id });

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const store = await readStore(userId);
  return NextResponse.json({ routines: store.routines, timezone: store.config.timezone });
}

async function updateRoutine(userId: string, body: unknown) {
  const t = await getExtracted();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: (({ name: t("Name is required."), instructions: t("Instruction is required."), cron: t("When to run is required.") } as Record<string, string>)[String(parsed.error.issues[0]?.path[0])] ?? t("Invalid routine.")) }, { status: 400 });
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
    item.nextRunAt = enabled ? (scheduleChanged || !item.nextRunAt ? nextRunAt ?? nextCron(cron, timezone) : item.nextRunAt) : null;
    if (changed) { item.revision = (item.revision ?? 0) + 1; item.lastError = null; }
    return item;
  });
  return routine ? NextResponse.json({ routine }) : NextResponse.json({ error: t("Routine not found.") }, { status: 404 });
}

export async function POST(request: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = await request.json().catch(() => null);
  try {
    // Preserve the existing POST-with-id interface for existing clients.
    if (body?.id) return await updateRoutine(userId, body);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: (({ name: t("Name is required."), instructions: t("Instruction is required."), cron: t("When to run is required.") } as Record<string, string>)[String(parsed.error.issues[0]?.path[0])] ?? t("Invalid routine.")) }, { status: 400 });
    const data = parsed.data;
    const routine = await mutateStore(userId, (store) => {
      const thread = store.threads.find((entry) => entry.id === data.threadId);
      if (!store.bots.some((bot) => bot.id === data.botId) || !thread?.botIds.includes(data.botId)) return null;
      const timezone = data.timezone ?? store.config.timezone;
      const nextRunAt = nextCron(data.cron, timezone);
      const enabled = data.enabled ?? true;
      const item = { id: createId("rtn"), botId: data.botId, threadId: data.threadId, name: data.name, instructions: data.instructions, cron: data.cron, timezone, enabled, revision: 0, lastRunAt: null, nextRunAt: enabled ? nextRunAt : null, lastError: null, createdAt: nowIso() };
      store.routines.push(item);
      return item;
    });
    return routine ? NextResponse.json({ routine }, { status: 201 }) : NextResponse.json({ error: t("Teammate or conversation not found.") }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: await localizeError(error, t("Could not save routine.")) }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  try { return await updateRoutine(userId, await request.json().catch(() => null)); }
  catch (error) { return NextResponse.json({ error: await localizeError(error, t("Could not update routine.")) }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const parsed = z.object({ id }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: t("Routine ID is required.") }, { status: 400 });
  const deleted = await mutateStore(userId, (store) => {
    const index = store.routines.findIndex((item) => item.id === parsed.data.id);
    if (index < 0) return false;
    store.routines.splice(index, 1);
    return true;
  });
  return deleted ? NextResponse.json({ deleted: parsed.data.id }) : NextResponse.json({ error: t("Routine not found.") }, { status: 404 });
}
