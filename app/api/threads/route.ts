import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { createId, nowIso } from "@/lib/ids";
import { mutateStore, readStore } from "@/lib/store";
import type { Thread } from "@/lib/types";
import { z } from "zod";
import { validAvatarIcon } from "@/lib/avatar";
import { getExtracted } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const parsed = z.object({ title: z.string().trim().max(120).optional(), botIds: z.array(z.string().min(1)).min(2).max(50), icon: z.custom<string | null>(validAvatarIcon).optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: t("Choose at least two teammates and a valid group name/icon.") }, { status: 400 });
  const body = parsed.data;
  const store = await readStore(userId);
  const botIds = [...new Set(body.botIds)].filter((id) => store.bots.some((bot) => bot.id === id));
  if (botIds.length < 2) {
    return NextResponse.json({ error: t("Choose at least two valid teammates.") }, { status: 400 });
  }
  const at = nowIso();
  const thread: Thread = {
    id: createId("grp"),
    kind: "group",
    icon: body.icon || null,
    title:
      body.title?.trim() ||
      botIds
        .map((id) => store.bots.find((bot) => bot.id === id)?.name)
        .filter(Boolean)
        .join(" · ").slice(0, 120),
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
