import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { nowIso } from "@/lib/ids";
import { slimMessagesForClient } from "@/lib/messages";
import { loadMessages, mutateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = await params;
  const messages = slimMessagesForClient(await loadMessages(userId, id, { clone: false }));
  return NextResponse.json({ messages });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = await params;
  const body = (await req.json()) as {
    pinned?: boolean;
    unread?: boolean;
    hidden?: boolean;
    section?: string | null;
  };
  const thread = await mutateStore(userId, (store) => {
    const item = store.threads.find((entry) => entry.id === id);
    if (!item) return null;
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
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ thread });
}
