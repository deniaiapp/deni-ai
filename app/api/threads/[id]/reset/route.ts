import { NextResponse } from "next/server";
import { getExtracted } from "next-intl/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { slimMessagesForClient } from "@/lib/messages";
import { limitOrResponse } from "@/lib/rate-limit";
import { loadMessages } from "@/lib/store";
import { resetThreadContext } from "@/lib/thread-context";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "thread-reset", 20);
  if (limited) return limited;
  const { id } = await params;
  const result = await resetThreadContext(userId, id);
  if (result === "missing") return NextResponse.json({ error: t("Conversation not found.") }, { status: 404 });
  if (result === "busy") {
    return NextResponse.json({ error: t("Stop or finish the current task before resetting the conversation.") }, { status: 409 });
  }
  const messages = slimMessagesForClient(await loadMessages(userId, id, { clone: false }));
  return NextResponse.json({ result, messages });
}
