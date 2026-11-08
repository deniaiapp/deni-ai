import { createFileRoute } from "@tanstack/react-router";
import { getExtracted } from "@/i18n/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/auth/api";
import { slimMessagesForClient } from "@/lib/chat/messages";
import { limitOrResponse } from "@/lib/billing/rate-limit";
import { loadMessages } from "@/lib/data/store";
import { clearThread, resetThreadContext } from "@/lib/agent/thread-context";

/** Resets what the model sees, or with { clear: true } deletes the conversation's history. */
async function POST({ request, params }: { request: Request; params: { id: string } }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "thread-reset", 20);
  if (limited) return limited;
  const { id } = params;
  const body = (await request.json().catch(() => ({}))) as { clear?: unknown };
  const result = body.clear === true ? await clearThread(userId, id) : await resetThreadContext(userId, id);
  if (result === "missing") return Response.json({ error: t("Conversation not found.") }, { status: 404 });
  if (result === "busy") {
    return Response.json({ error: t("Stop or finish the current task before resetting the conversation.") }, { status: 409 });
  }
  const messages = slimMessagesForClient(await loadMessages(userId, id, { clone: false }));
  return Response.json({ result, messages });
}

export const Route = createFileRoute("/api/threads/$id/reset")({
  server: { handlers: { POST } },
});
