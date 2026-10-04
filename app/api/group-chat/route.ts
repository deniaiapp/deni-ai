import { createUIMessageStream, createUIMessageStreamResponse, readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { groupRecipients, messageAuthor, messageRequestKey } from "@/lib/group-chat";
import { readStore, loadMessages } from "@/lib/store";
import { listJobs } from "@/lib/jobs";
import { slimMessagesForClient } from "@/lib/messages";
import { POST as respondAsTeammate } from "../chat/route";
import { getExtracted } from "next-intl/server";
import { localizeError } from "@/lib/localize-error";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

function messageChunks(body: ReadableStream<Uint8Array>, onStatus: (data: Record<string, unknown>) => void) {
  let buffer = "";
  const decoder = new TextDecoder();
  const decoded = body.pipeThrough(new TransformStream<Uint8Array, string>({
    transform(chunk, controller) {
      controller.enqueue(decoder.decode(new Uint8Array(chunk), { stream: true }));
    },
    flush(controller) {
      const tail = decoder.decode();
      if (tail) controller.enqueue(tail);
    },
  }));
  return decoded.pipeThrough(new TransformStream<string, UIMessageChunk>({
    transform(chunk, controller) {
      buffer += chunk;
      let separator: RegExpMatchArray | null;
      while ((separator = buffer.match(/\r?\n\r?\n/))) {
        const index = separator.index ?? 0;
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + separator[0].length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") continue;
        const value = JSON.parse(data);
        if (value.type === "data-job-status") onStatus(value.data ?? {});
        else controller.enqueue(value as UIMessageChunk);
      }
    },
  }));
}

export async function POST(request: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = await request.json() as { threadId?: string; messages?: UIMessage[]; runMode?: string; idempotencyKey?: string };
  const store = await readStore(userId);
  const thread = store.threads.find((item) => item.id === body.threadId && item.kind === "group");
  if (!thread) return new Response(t("Group not found."), { status: 404 });
  const members = store.bots.filter((bot) => thread.botIds.includes(bot.id));
  const input = body.messages?.at(-1);
  if (!input?.id || !["user", "assistant"].includes(input.role)) return new Response(t("A message is required"), { status: 400 });
  const persisted = await loadMessages(userId, thread.id);
  let recipients = members;
  if (input.role === "user") {
    const text = input.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    try { recipients = groupRecipients(text, members); }
    catch (error) { return new Response(await localizeError(error, t("Invalid mention")), { status: 400 }); }
  } else {
    const source = persisted.find((message) => message.id === input.id);
    const author = source && messageAuthor(source);
    recipients = members.filter((bot) => bot.id === author?.id);
  }
  if (!recipients.length) return new Response(t("No matching teammate in this group"), { status: 400 });
  const jobs = await listJobs(userId, { threadId: thread.id, limit: 200, summary: true });
  const statuses = new Map<string, string>();
  return createUIMessageStreamResponse({ stream: createUIMessageStream<UIMessage>({
    execute: async ({ writer }) => {
      let disconnected = false;
      const emit = (type: string, data: unknown) => {
        if (disconnected) return;
        try { writer.write({ type, transient: true, data } as never); }
        catch { disconnected = true; }
      };
      emit("data-group-targets", { authors: recipients.map(({ id, name, accent }) => ({ id, name, accent })) });
      await Promise.allSettled(recipients.map(async (bot) => {
        const author = { id: bot.id, name: bot.name, accent: bot.accent };
        const report = (status: string, extra: Record<string, unknown> = {}) => {
          statuses.set(bot.id, status);
          emit("data-group-status", { ...extra, author, status });
        };
        report("working");
        try {
          const pending = jobs.find((job) => job.botId === bot.id && job.kind === "chat" && ["queued", "running", "finalizing", "waiting_approval", "waiting_takeover"].includes(job.status));
          if (input.role === "assistant" && pending?.status !== "waiting_approval") throw new Error(t("This approval is no longer pending."));
          const response = await respondAsTeammate(new Request(new URL("/api/chat", request.url), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ threadId: thread.id, botId: bot.id, messages: [input], runMode: body.runMode, idempotencyKey: `group:${thread.id}:${messageRequestKey(input)}:${bot.id}`, ...(pending ? { jobId: pending.id } : {}) }),
          }));
          if (!response.ok || !response.body) {
            const text = await response.text();
            const detail = response.headers.get("content-type")?.includes("text/plain") ? text.slice(0, 500) : t("Could not respond ({status}).", { status: String(response.status) });
            throw new Error(detail);
          }
          const stream = messageChunks(response.body, (data) => report(typeof data.status === "string" ? data.status : "working", { jobId: data.jobId }));
          let latest: UIMessage | undefined;
          let lastEmittedAt = 0;
          for await (const message of readUIMessageStream({ stream, message: input.role === "assistant" ? input : undefined, terminateOnError: true })) {
            latest = { ...message, metadata: { ...(message.metadata as object ?? {}), author } };
            if (Date.now() - lastEmittedAt >= 80) {
              emit("data-group-message", { message: slimMessagesForClient([latest])[0] });
              lastEmittedAt = Date.now();
            }
          }
          if (latest) emit("data-group-message", { message: slimMessagesForClient([latest])[0] });
          if (!["waiting", "failed", "completed"].includes(statuses.get(bot.id) ?? "")) report("completed");
        } catch (error) {
          report("failed", { error: error instanceof Error ? error.message : t("This teammate could not respond.") });
        }
      }));
      const values = [...statuses.values()];
      emit("data-group-finished", { status: values.includes("waiting") ? "waiting" : values.every((status) => status === "failed") ? "failed" : "completed" });
    },
  }) });
}
