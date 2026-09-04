import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { createId, nowIso } from "@/lib/ids";
import { mutateStore } from "@/lib/store";
import type { Bot, Thread } from "@/lib/types";
import { limitOrResponse } from "@/lib/rate-limit";
import { assertCanCreateTeammate, isUsageLimitError, usageLimitPayload } from "@/lib/usage";

export const dynamic = "force-dynamic";

const ACCENTS = ["#d4a574", "#8fad86", "#7f9bb8", "#c97b7b", "#c4b36a", "#b08bb8"];

export async function POST(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "bots", 20);
  if (limited) return limited;
  const body = (await req.json()) as {
    name?: string;
    job?: string;
    instructions?: string;
  };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  try {
    await assertCanCreateTeammate(userId);
  } catch (error) {
    if (isUsageLimitError(error)) {
      return NextResponse.json(usageLimitPayload(error), { status: 402 });
    }
    throw error;
  }
  const at = nowIso();
  const bot: Bot = {
    id: createId("bot"),
    name,
    job: body.job?.trim() || "Teammate",
    instructions:
      body.instructions?.trim() ||
      `You are Deni Run's teammate "${name}". Complete the assigned work on the computer.`,
    accent: ACCENTS[Math.floor(Math.random() * ACCENTS.length)],
    createdAt: at,
    updatedAt: at,
    memory: [],
  };
  const thread: Thread = {
    id: `dm_${bot.id}`,
    kind: "dm",
    title: bot.name,
    botIds: [bot.id],
    createdAt: at,
    updatedAt: at,
    lastPreview: "Send me a task",
    pinned: false,
    unread: false,
    hidden: false,
    section: null,
  };
  await mutateStore(userId, (store) => {
    store.bots.push(bot);
    store.threads.push(thread);
  });
  return NextResponse.json({ bot, thread });
}
