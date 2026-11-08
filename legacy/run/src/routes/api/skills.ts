import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/auth/api";
import { deleteSkill, saveSkill, skillSchema } from "@/lib/agent/skills";
import { readStore } from "@/lib/data/store";
import { z } from "zod";
import { getExtracted } from "@/i18n/server";
import { localizeError } from "@/i18n/localize-error";

async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const store = await readStore(userId);
  return Response.json({ skills: store.skills });
}

async function save(req: Request, requireId: boolean) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const parsed = skillSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: t("Name and instructions are required.") }, { status: 400 });
  }
  const body = parsed.data;
  if (requireId && !body.id) return Response.json({ error: t("Skill ID is required.") }, { status: 400 });
  try {
    const result = await saveSkill(userId, body);
    if (result.ok) return Response.json({ skill: result.skill });
    if (result.reason === "duplicate") return Response.json({ error: t("A skill with this name already exists.") }, { status: 400 });
    if (result.reason === "not_found") return Response.json({ error: t("Skill not found.") }, { status: 404 });
    return Response.json({ error: t("Name and instructions are required.") }, { status: 400 });
  } catch (error) { return Response.json({ error: await localizeError(error, t("Could not save skill.")) }, { status: 400 }); }
}

async function POST({ request: req }: { request: Request }) { return save(req, false); }
async function PATCH({ request: req }: { request: Request }) { return save(req, true); }

async function DELETE({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const parsed = z.object({ id: z.string().trim().min(1).max(200) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: t("Skill ID is required.") }, { status: 400 });
  const deleted = await deleteSkill(userId, parsed.data.id);
  return deleted
    ? Response.json({ deleted: parsed.data.id })
    : Response.json({ error: t("Skill not found.") }, { status: 404 });
}

export const Route = createFileRoute("/api/skills")({
  server: { handlers: { GET, POST, PATCH, DELETE } },
});
