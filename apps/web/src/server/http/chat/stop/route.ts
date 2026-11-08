import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  getChatGenerationContextById,
  recordChatStopRequestedAt,
  stopActiveChatGeneration,
} from "@/lib/chat";
import { recordChatStopRequest, stopChatGeneration } from "@/lib/chat-generation";
import { guardMutationRequest } from "@/lib/mutation-request";
import { readRequestJson, RequestBodyTooLargeError } from "@/lib/request-body";

export async function POST(req: Request) {
  // Arrival time, so requests sent after this stop are never stopped by it.
  const requestedAt = Date.now();
  const rejected = guardMutationRequest(req, "application/json");
  if (rejected) return rejected;
  const headersList = req.headers;
  const session = await auth.api.getSession({ headers: headersList });
  const userId = session?.session?.userId;

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await readRequestJson(req, 4096);
  } catch (error) {
    return Response.json(
      { error: "Invalid request body" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  const parsedBody = z
    .object({
      id: z.string().min(1),
    })
    .safeParse(body);

  if (!parsedBody.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const chat = await getChatGenerationContextById(parsedBody.data.id, userId);
  if (!chat) {
    return Response.json({ error: "Chat not found" }, { status: 404 });
  }

  // A request sent just before this stop may not have registered its generation
  // yet; it checks for this stop when it does. In memory for a request on this
  // instance, and on the chat row for one on another instance. The row is
  // written before the active generation is read, so a generation that
  // registers meanwhile either sees this stop or is stopped below.
  recordChatStopRequest(chat.id, requestedAt);
  await recordChatStopRequestedAt(chat.id, userId, new Date(requestedAt));

  // Clearing the active generation and its pending flag is one guarded write,
  // so a generation started meanwhile is neither stopped nor overwritten.
  const stoppedGenerationId = await stopActiveChatGeneration(chat.id, userId);
  if (stoppedGenerationId) stopChatGeneration(chat.id, stoppedGenerationId);

  return Response.json({ ok: true });
}
