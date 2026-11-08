import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { errorMessage, readJson, runError, type RunRequestContext } from "./context";

/**
 * POST /api/run/group-chat: one message to a group thread. The recipients (`@name`,
 * `@everyone`, or every member) each get a `handleChat` call of their own; their
 * replies stream back as transient `data-group-*` parts (targets, per-author status,
 * the author's message so far, and the overall result).
 */

const ACTIVE = ["queued", "running", "finalizing", "waiting_approval", "waiting_takeover"];

function messageChunks(
  body: ReadableStream<Uint8Array>,
  onStatus: (data: Record<string, unknown>) => void,
) {
  let buffer = "";
  return body
    .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
    .pipeThrough(
      new TransformStream<string, UIMessageChunk>({
        transform(chunk, controller) {
          buffer += chunk;
          let separator: RegExpMatchArray | null;
          while ((separator = buffer.match(/\r?\n\r?\n/))) {
            const index = separator.index ?? 0;
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + separator[0].length);
            const data = frame
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (!data || data === "[DONE]") continue;
            const value = JSON.parse(data) as { type?: string; data?: Record<string, unknown> };
            if (value.type === "data-job-status") onStatus(value.data ?? {});
            else controller.enqueue(value as UIMessageChunk);
          }
        },
      }),
    );
}

export async function handleGroupChat({ request, userId, locale }: RunRequestContext) {
  const body = await readJson<{
    threadId?: string;
    messages?: UIMessage[];
    runMode?: string;
  }>(request);
  const [{ readStore, loadMessages }, groupChat, { listJobs }, { slimMessagesForClient }] =
    await Promise.all([
      import("@deniai/run/data/store"),
      import("@deniai/run/chat/group-chat"),
      import("@deniai/run/jobs/index"),
      import("@deniai/run/chat/messages"),
    ]);
  const { handleChat } = await import("@deniai/run/chat/route");
  const { assertCanUseTokens } = await import("@deniai/run/billing/usage");
  const store = await readStore(userId);
  const thread = store.threads.find((item) => item.id === body?.threadId && item.kind === "group");
  if (!thread) return runError(404, "thread_not_found");
  const members = store.bots.filter((bot) => thread.botIds.includes(bot.id));
  const input = body?.messages?.at(-1);
  if (!input?.id || !["user", "assistant"].includes(input.role))
    return runError(400, "message_required");
  let recipients = members;
  if (input.role === "user") {
    const text = input.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    try {
      recipients = groupChat.groupRecipients(text, members);
    } catch (error) {
      return runError(400, "invalid_mention", { message: errorMessage(error) });
    }
  } else {
    const persisted = await loadMessages(userId, thread.id);
    const source = persisted.find((message) => message.id === input.id);
    const author = source && groupChat.messageAuthor(source);
    recipients = members.filter((bot) => bot.id === author?.id);
  }
  if (!recipients.length) return runError(400, "no_recipient");
  // A usage limit is reported once for the group, not as a failure from every teammate.
  await assertCanUseTokens(userId);
  const jobs = await listJobs(userId, { threadId: thread.id, limit: 200, summary: true });
  const statuses = new Map<string, string>();

  return createUIMessageStreamResponse({
    stream: createUIMessageStream<UIMessage>({
      execute: async ({ writer }) => {
        let disconnected = false;
        const emit = (type: string, data: unknown) => {
          if (disconnected) return;
          try {
            writer.write({ type, transient: true, data } as never);
          } catch {
            disconnected = true;
          }
        };
        emit("data-group-targets", {
          authors: recipients.map(({ id, name, accent }) => ({ id, name, accent })),
        });
        await Promise.allSettled(
          recipients.map(async (bot) => {
            const author = { id: bot.id, name: bot.name, accent: bot.accent };
            const report = (status: string, extra: Record<string, unknown> = {}) => {
              statuses.set(bot.id, status);
              emit("data-group-status", { ...extra, author, status });
            };
            report("working");
            try {
              const pending = jobs.find(
                (job) => job.botId === bot.id && job.kind === "chat" && ACTIVE.includes(job.status),
              );
              if (input.role === "assistant" && pending?.status !== "waiting_approval")
                throw new Error("This approval is no longer pending.");
              const response = await handleChat(
                new Request(new URL("/api/run/chat", request.url), {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    threadId: thread.id,
                    botId: bot.id,
                    messages: [input],
                    runMode: body?.runMode,
                    idempotencyKey: `group:${thread.id}:${groupChat.messageRequestKey(input)}:${bot.id}`,
                    ...(pending ? { jobId: pending.id } : {}),
                  }),
                  signal: request.signal,
                }),
                { userId, locale },
              );
              if (!response.ok || !response.body) {
                const text = await response.text();
                throw new Error(text.slice(0, 500) || `HTTP ${response.status}`);
              }
              const stream = messageChunks(response.body, (data) =>
                report(typeof data.status === "string" ? data.status : "working", {
                  jobId: data.jobId,
                }),
              );
              let latest: UIMessage | undefined;
              let lastEmittedAt = 0;
              for await (const message of readUIMessageStream({
                stream,
                message: input.role === "assistant" ? input : undefined,
                terminateOnError: true,
              })) {
                latest = {
                  ...message,
                  metadata: { ...(message.metadata as object), author },
                };
                if (Date.now() - lastEmittedAt >= 80) {
                  emit("data-group-message", { message: slimMessagesForClient([latest])[0] });
                  lastEmittedAt = Date.now();
                }
              }
              if (latest)
                emit("data-group-message", { message: slimMessagesForClient([latest])[0] });
              if (!["waiting", "failed", "completed"].includes(statuses.get(bot.id) ?? ""))
                report("completed");
            } catch (error) {
              report("failed", { error: errorMessage(error) });
            }
          }),
        );
        const values = [...statuses.values()];
        emit("data-group-finished", {
          status: values.includes("waiting")
            ? "waiting"
            : values.every((status) => status === "failed")
              ? "failed"
              : "completed",
        });
      },
    }),
  });
}
