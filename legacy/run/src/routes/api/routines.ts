import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getApiUserId, unauthorizedResponse } from "@/lib/auth/api";
import { createRoutine, deleteRoutine, updateRoutine, type UpdateRoutineInput } from "@/lib/jobs/routines";
import { readStore } from "@/lib/data/store";
import { getExtracted, getLocale } from "@/i18n/server";
import { localizeError } from "@/i18n/localize-error";

const id = z.string().trim().min(1).max(200);

async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const store = await readStore(userId);
  return Response.json({ routines: store.routines, timezone: store.config.timezone });
}

async function invalidResponse(field: string) {
  const t = await getExtracted();
  return Response.json({ error: (({ name: t("Name is required."), instructions: t("Instruction is required."), cron: t("When to run is required.") } as Record<string, string>)[field] ?? t("Invalid routine.")) }, { status: 400 });
}

// Bodies arrive unchecked; src/lib/jobs/routines validates them.
async function update(userId: string, body: UpdateRoutineInput) {
  const t = await getExtracted();
  const result = await updateRoutine(userId, body, await getLocale());
  if (result.ok) return Response.json({ routine: result.routine });
  return result.reason === "invalid" ? await invalidResponse(result.field) : Response.json({ error: t("Routine not found.") }, { status: 404 });
}

async function POST({ request }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = await request.json().catch(() => null);
  try {
    // Preserve the existing POST-with-id interface for existing clients.
    if (body?.id) return await update(userId, body);
    const result = await createRoutine(userId, body, await getLocale());
    if (result.ok) return Response.json({ routine: result.routine }, { status: 201 });
    return result.reason === "invalid" ? await invalidResponse(result.field) : Response.json({ error: t("Teammate or conversation not found.") }, { status: 404 });
  } catch (error) {
    return Response.json({ error: await localizeError(error, t("Could not save routine.")) }, { status: 400 });
  }
}

async function PATCH({ request }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  try { return await update(userId, await request.json().catch(() => null)); }
  catch (error) { return Response.json({ error: await localizeError(error, t("Could not update routine.")) }, { status: 400 }); }
}

async function DELETE({ request }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const parsed = z.object({ id }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: t("Routine ID is required.") }, { status: 400 });
  const deleted = await deleteRoutine(userId, parsed.data.id);
  return deleted ? Response.json({ deleted: parsed.data.id }) : Response.json({ error: t("Routine not found.") }, { status: 404 });
}

export const Route = createFileRoute("/api/routines")({
  server: { handlers: { GET, POST, PATCH, DELETE } },
});
