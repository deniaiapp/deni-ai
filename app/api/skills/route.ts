import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { deleteSkill, saveSkill, skillSchema } from "@/lib/skills";
import { readStore } from "@/lib/store";
import { z } from "zod";
import { getExtracted } from "next-intl/server";
import { localizeError } from "@/lib/localize-error";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const store = await readStore(userId);
  return NextResponse.json({ skills: store.skills });
}

async function save(req: Request, requireId: boolean) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const parsed = skillSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: t("Name and instructions are required.") }, { status: 400 });
  }
  const body = parsed.data;
  if (requireId && !body.id) return NextResponse.json({ error: t("Skill ID is required.") }, { status: 400 });
  try {
    const result = await saveSkill(userId, body);
    if (result.ok) return NextResponse.json({ skill: result.skill });
    if (result.reason === "duplicate") return NextResponse.json({ error: t("A skill with this name already exists.") }, { status: 400 });
    if (result.reason === "not_found") return NextResponse.json({ error: t("Skill not found.") }, { status: 404 });
    return NextResponse.json({ error: t("Name and instructions are required.") }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: await localizeError(error, t("Could not save skill.")) }, { status: 400 }); }
}

export async function POST(req: Request) { return save(req, false); }
export async function PATCH(req: Request) { return save(req, true); }

export async function DELETE(req: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const parsed = z.object({ id: z.string().trim().min(1).max(200) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: t("Skill ID is required.") }, { status: 400 });
  const deleted = await deleteSkill(userId, parsed.data.id);
  return deleted
    ? NextResponse.json({ deleted: parsed.data.id })
    : NextResponse.json({ error: t("Skill not found.") }, { status: 404 });
}
