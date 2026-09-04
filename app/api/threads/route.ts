import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { createId, nowIso } from "@/lib/ids";
import { mutateStore, readStore } from "@/lib/store";
import type { Thread } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json()) as { title?: string; botIds?: string[] };
  const store = await readStore(userId);
  const botIds = (body.botIds ?? []).filter((id) => store.bots.some((bot) => bot.id === id));
  if (botIds.length < 2) {
    return NextResponse.json({ error: "group needs 2+ bots" }, { status: 400 });
  }
  const at = nowIso();
  const thread: Thread = {
    id: createId("grp"),
    kind: "group",
    title:
      body.title?.trim() ||
      botIds
        .map((id) => store.bots.find((bot) => bot.id === id)?.name)
        .filter(Boolean)
        .join(" · "),
    botIds,
    createdAt: at,
    updatedAt: at,
    lastPreview: "Group started",
    pinned: false,
    unread: false,
    hidden: false,
    section: null,
  };
  await mutateStore(userId, (s) => {
    s.threads.push(thread);
  });
  return NextResponse.json({ thread });
}
