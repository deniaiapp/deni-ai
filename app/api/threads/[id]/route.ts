import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { nowIso } from "@/lib/ids";
import { applyGroupEdits } from "@/lib/groups";
import { slimMessagesForClient } from "@/lib/messages";
import { deleteGroupThread, loadMessages, mutateStore } from "@/lib/store";
import { validAvatarIcon } from "@/lib/avatar";
import { z } from "zod";
import { getExtracted } from "next-intl/server";
import { localizeError } from "@/lib/localize-error";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = await params;
  const messages = slimMessagesForClient(await loadMessages(userId, id, { clone: false }));
  return NextResponse.json({ messages });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = await params;
  const parsed = z.object({ pinned: z.boolean().optional(), unread: z.boolean().optional(), hidden: z.boolean().optional(), section: z.string().trim().max(100).nullable().optional(), title: z.string().trim().min(1).max(120).optional(), icon: z.custom<string | null>(validAvatarIcon).optional(), botIds: z.array(z.string().min(1)).min(2).max(50).optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: t("Invalid conversation settings.") }, { status: 400 });
  const body = parsed.data;
  try {
  const thread = await mutateStore(userId, (store) => {
    const item = store.threads.find((entry) => entry.id === id);
    if (!item) return null;
    const edited = applyGroupEdits(store, item, body);
    if (!edited.ok) throw new Error(edited.reason === "not_group" ? t("Use the teammate profile to edit a DM.") : t("Choose at least two valid teammates."));
    if (typeof body.pinned === "boolean") item.pinned = body.pinned;
    if (typeof body.unread === "boolean") item.unread = body.unread;
    if (typeof body.hidden === "boolean") item.hidden = body.hidden;
    if (body.section !== undefined) {
      const name = typeof body.section === "string" ? body.section.trim() : "";
      item.section = name || null;
    }
    item.updatedAt = nowIso();
    return item;
  });
  if (!thread) return NextResponse.json({ error: t("Conversation not found.") }, { status: 404 });
  return NextResponse.json({ thread });
  } catch (error) { return NextResponse.json({ error: await localizeError(error, t("Could not update conversation.")) }, { status: 400 }); }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = await params;
  const deleted = await deleteGroupThread(userId, id);
  return deleted ? NextResponse.json({ deleted: id }) : NextResponse.json({ error: t("Group not found.") }, { status: 404 });
}
