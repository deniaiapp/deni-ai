import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/auth/api";
import { nowIso } from "@/lib/data/ids";
import { applyGroupEdits } from "@/lib/chat/groups";
import { slimMessagesForClient } from "@/lib/chat/messages";
import { deleteGroupThread, loadMessages, mutateStore } from "@/lib/data/store";
import { validAvatarIcon } from "@/lib/teammates/avatar";
import { z } from "zod";
import { getExtracted } from "@/i18n/server";
import { localizeError } from "@/i18n/localize-error";

async function GET({ params }: { params: { id: string } }) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = params;
  const messages = slimMessagesForClient(await loadMessages(userId, id, { clone: false }));
  return Response.json({ messages });
}

async function PATCH({ request: req, params }: { request: Request; params: { id: string } }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = params;
  const parsed = z.object({ pinned: z.boolean().optional(), unread: z.boolean().optional(), hidden: z.boolean().optional(), section: z.string().trim().max(100).nullable().optional(), title: z.string().trim().min(1).max(120).optional(), icon: z.custom<string | null>(validAvatarIcon).optional(), botIds: z.array(z.string().min(1)).min(2).max(50).optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: t("Invalid conversation settings.") }, { status: 400 });
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
  if (!thread) return Response.json({ error: t("Conversation not found.") }, { status: 404 });
  return Response.json({ thread });
  } catch (error) { return Response.json({ error: await localizeError(error, t("Could not update conversation.")) }, { status: 400 }); }
}

async function DELETE({ params }: { params: { id: string } }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = params;
  const deleted = await deleteGroupThread(userId, id);
  return deleted ? Response.json({ deleted: id }) : Response.json({ error: t("Group not found.") }, { status: 404 });
}

export const Route = createFileRoute("/api/threads/$id/")({
  server: { handlers: { GET, PATCH, DELETE } },
});
