import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { loadMessages, mutateStore, readStore } from "@/lib/store";
import { isMessageReaction, messageBubbleTargets, updateReactions } from "@/lib/message-actions";
import { getExtracted } from "@/i18n/server";

const schema = z.object({
  messageId: z.string().min(1).max(512),
  emoji: z.string().max(64).refine(isMessageReaction, "Choose a single emoji"),
  selected: z.boolean(),
});

async function GET({ params }: { params: { id: string } }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = params;
  const thread = (await readStore(userId)).threads.find((item) => item.id === id);
  if (!thread) return Response.json({ error: t("Conversation not found.") }, { status: 404 });
  return Response.json({ reactions: thread.reactions ?? {} });
}

async function PUT({ request, params }: { request: Request; params: { id: string } }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: t("Invalid reaction") }, { status: 400 });
  const { messageId, emoji, selected } = parsed.data;
  const store = await readStore(userId);
  if (!store.threads.some((thread) => thread.id === id)) {
    return Response.json({ error: t("Conversation not found.") }, { status: 404 });
  }
  const messages = await loadMessages(userId, id);
  if (!messages.some((message, index) => messageBubbleTargets(message, index).some((bubble) => bubble.key === messageId))) {
    return Response.json({ error: t("Message not found") }, { status: 404 });
  }
  const reactions = await mutateStore(userId, (next) => {
    const thread = next.threads.find((item) => item.id === id);
    if (!thread) return null;
    const map = { ...thread.reactions };
    const previous = Object.hasOwn(map, messageId) ? map[messageId] : [];
    const updated = updateReactions(previous ?? [], emoji, selected);
    if (updated.length) map[messageId] = updated;
    else delete map[messageId];
    thread.reactions = map;
    return map;
  });
  if (!reactions) return Response.json({ error: t("Conversation not found.") }, { status: 404 });
  return Response.json({ reactions });
}

export const Route = createFileRoute("/api/threads/$id/reactions")({
  server: { handlers: { GET, PUT } },
});
