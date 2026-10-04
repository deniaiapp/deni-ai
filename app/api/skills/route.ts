import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { createId, nowIso } from "@/lib/ids";
import { mutateStore, readStore } from "@/lib/store";
import { z } from "zod";
import { getExtracted } from "next-intl/server";
import { localizeError } from "@/lib/localize-error";

export const dynamic = "force-dynamic";
const skillSchema = z.object({ id: z.string().min(1).max(200).optional(), name: z.string().trim().min(1).max(120), body: z.string().min(1).max(100000).refine((value) => Boolean(value.trim())) });

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const store = await readStore(userId);
  return NextResponse.json({ skills: store.skills });
}

async function saveSkill(req: Request, requireId: boolean) {
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
  const skill = await mutateStore(userId, (store) => {
    if (store.skills.some((item) => item.id !== body.id && item.name.toLowerCase() === body.name.toLowerCase())) throw new Error(t("A skill with this name already exists."));
    if (body.id) {
      const item = store.skills.find((entry) => entry.id === body.id);
      if (!item) return null;
      item.name = body.name; item.body = body.body; item.updatedAt = nowIso();
      return item;
    }
    const created = {
      id: createId("skill"),
      name: body.name,
      body: body.body,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.skills.push(created);
    return created;
  });
  return skill ? NextResponse.json({ skill }) : NextResponse.json({ error: t("Skill not found.") }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: await localizeError(error, t("Could not save skill.")) }, { status: 400 }); }
}

export async function POST(req: Request) { return saveSkill(req, false); }
export async function PATCH(req: Request) { return saveSkill(req, true); }

export async function DELETE(req: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const parsed = z.object({ id: z.string().trim().min(1).max(200) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: t("Skill ID is required.") }, { status: 400 });
  const deleted = await mutateStore(userId, (store) => {
    const index = store.skills.findIndex((skill) => skill.id === parsed.data.id);
    if (index === -1) return false;
    store.skills.splice(index, 1);
    return true;
  });
  return deleted
    ? NextResponse.json({ deleted: parsed.data.id })
    : NextResponse.json({ error: t("Skill not found.") }, { status: 404 });
}
