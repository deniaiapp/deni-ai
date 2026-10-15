import { createFileRoute } from "@tanstack/react-router";
import { getExtracted } from "@/i18n/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { slimMessagesForClient } from "@/lib/messages";
import { limitOrResponse } from "@/lib/rate-limit";
import { loadMessages } from "@/lib/store";
import { resetThreadContext } from "@/lib/thread-context";

async function POST({ params }: { params: { id: string } }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "thread-reset", 20);
  if (limited) return limited;
  const { id } = params;
  const result = await resetThreadContext(userId, id);
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
