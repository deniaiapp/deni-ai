import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { loadMessages, mutateStore, readStore } from "@/lib/store";
import { isMessageReaction, messageBubbleTargets, updateReactions } from "@/lib/message-actions";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({
  messageId: z.string().min(1).max(512),
  emoji: z.string().max(64).refine(isMessageReaction, "Choose a single emoji"),
  selected: z.boolean(),
});

export async function GET(_request: Request, { params }: Context) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = await params;
  const thread = (await readStore(userId)).threads.find((item) => item.id === id);
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  return NextResponse.json({ reactions: thread.reactions ?? {} });
}

export async function PUT(request: Request, { params }: Context) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid reaction" }, { status: 400 });
  const { messageId, emoji, selected } = parsed.data;
  const store = await readStore(userId);
  if (!store.threads.some((thread) => thread.id === id)) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  const messages = await loadMessages(userId, id);
  if (!messages.some((message, index) => messageBubbleTargets(message, index).some((bubble) => bubble.key === messageId))) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
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
  if (!reactions) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  return NextResponse.json({ reactions });
}
