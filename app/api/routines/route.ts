import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { createRoutine, deleteRoutine, updateRoutine, type UpdateRoutineInput } from "@/lib/routines";
import { readStore } from "@/lib/store";
import { getExtracted, getLocale } from "next-intl/server";
import { localizeError } from "@/lib/localize-error";

export const dynamic = "force-dynamic";
const id = z.string().trim().min(1).max(200);

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const store = await readStore(userId);
  return NextResponse.json({ routines: store.routines, timezone: store.config.timezone });
}

async function invalidResponse(field: string) {
  const t = await getExtracted();
  return NextResponse.json({ error: (({ name: t("Name is required."), instructions: t("Instruction is required."), cron: t("When to run is required.") } as Record<string, string>)[field] ?? t("Invalid routine.")) }, { status: 400 });
}

// Bodies arrive unchecked; lib/routines validates them.
async function update(userId: string, body: UpdateRoutineInput) {
  const t = await getExtracted();
  const result = await updateRoutine(userId, body, await getLocale());
  if (result.ok) return NextResponse.json({ routine: result.routine });
  return result.reason === "invalid" ? await invalidResponse(result.field) : NextResponse.json({ error: t("Routine not found.") }, { status: 404 });
}

export async function POST(request: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = await request.json().catch(() => null);
  try {
    // Preserve the existing POST-with-id interface for existing clients.
    if (body?.id) return await update(userId, body);
    const result = await createRoutine(userId, body, await getLocale());
    if (result.ok) return NextResponse.json({ routine: result.routine }, { status: 201 });
    return result.reason === "invalid" ? await invalidResponse(result.field) : NextResponse.json({ error: t("Teammate or conversation not found.") }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: await localizeError(error, t("Could not save routine.")) }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  try { return await update(userId, await request.json().catch(() => null)); }
  catch (error) { return NextResponse.json({ error: await localizeError(error, t("Could not update routine.")) }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const parsed = z.object({ id }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: t("Routine ID is required.") }, { status: 400 });
  const deleted = await deleteRoutine(userId, parsed.data.id);
  return deleted ? NextResponse.json({ deleted: parsed.data.id }) : NextResponse.json({ error: t("Routine not found.") }, { status: 404 });
}
