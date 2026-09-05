import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isLoopFinished,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { limitOrResponse } from "@/lib/rate-limit";
import { reportError } from "@/lib/report";
import { buildInstructions, createDeniTools, deniToolApproval } from "@/lib/agent";
import { getApiKey } from "@/lib/config";
import { setComputer } from "@/lib/computer";
import { getDeniModel } from "@/lib/llm";
import { parseRunMode } from "@/lib/model";
import { loadMessages, mutateStore, readStore, saveMessages } from "@/lib/store";
import { assertCanUseTokens, isUsageLimitError, recordTokenUsage } from "@/lib/usage";
import { compactMessagesForModel, mergeThreadMessages } from "@/lib/messages";
import {
  checkpointJob,
  claimJob,
  createJob,
  finishJob,
  getJob,
  getJobByIdempotencyKey,
  heartbeatJob,
  transitionJob,
  updateJob,
} from "@/lib/jobs";
import { createNotification } from "@/lib/notifications";
import { hasPendingWorkflowWait, lastAssistantText } from "@/lib/chat-run-state";
import { messagesWithReplyContext, resolveReplyReferences } from "@/lib/message-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "chat", 40);
  if (limited) return limited;
  const body = (await req.json()) as {
    messages?: UIMessage[];
    botId?: string;
    threadId?: string;
    id?: string;
    idempotencyKey?: string;
    jobId?: string;
    runMode?: string;
  };

  const threadId = body.threadId || body.id;
  const store = await readStore(userId);
  const thread = store.threads.find((item) => item.id === threadId);
  if (!thread) {
    return new Response("thread not found", { status: 404 });
  }

  const botId = body.botId || thread.botIds[0];
  const bot = store.bots.find((item) => item.id === botId);
  if (!bot) {
    return new Response("bot not found", { status: 404 });
  }

  const apiKey = await getApiKey(userId);
  if (!apiKey) {
    return new Response("OPENROUTER_API_KEY is missing", { status: 401 });
  }

  try {
    await assertCanUseTokens(userId);
  } catch (error) {
    if (isUsageLimitError(error)) {
      return new Response(error.message, { status: 402 });
    }
    throw error;
  }

  let incoming = body.messages ?? [];
  const persisted = await loadMessages(userId, thread.id);
  try { incoming = resolveReplyReferences(incoming, persisted); }
  catch { return Response.json({ error: "The message you replied to is no longer available." }, { status: 400 }); }
  const messages = mergeThreadMessages(persisted, incoming);
  const runMode = parseRunMode(body.runMode ?? store.config.runMode);
  if (body.runMode && runMode !== store.config.runMode) {
    await mutateStore(userId, (next) => {
      next.config.runMode = runMode;
    });
  }

  const { model, providerOptions, tokenMultiplier } = await getDeniModel(userId, runMode);
  const idempotencyKey =
    body.idempotencyKey?.trim() ||
    body.jobId?.trim() ||
    `chat:${thread.id}:${incoming.at(-1)?.id || Date.now()}`;
  const resumeCandidate = body.jobId ? await getJob(userId, body.jobId) : null;
  let job = resumeCandidate && resumeCandidate.threadId === thread.id && resumeCandidate.botId === bot.id
    ? resumeCandidate
    : null;
  if (job && job.status !== "queued") {
    return Response.json({ jobId: job.id, status: job.status, reconnected: true }, { status: 409 });
  }
  if (!job) {
    const existing = await getJobByIdempotencyKey(userId, idempotencyKey);
    if (existing && existing.status !== "failed" && existing.status !== "cancelled") {
      return Response.json({ jobId: existing.id, status: existing.status, reconnected: true }, { status: 409 });
    }
    job = await createJob({
      userId,
      threadId: thread.id,
      botId: bot.id,
      kind: "chat",
      idempotencyKey,
      payload: { messages, runMode },
    });
  }
  if (resumeCandidate && job) {
    job = (await updateJob(userId, job.id, { payload: { ...job.payload, messages, runMode } })) ?? job;
  }
  // Persist the user message before opening the stream so a thread can be left and
  // reopened while the model is still running without losing its context.
  await saveMessages(userId, thread.id, messages);
  const claimed = await claimJob(userId, job.id);
  if (!claimed || !claimed.claimed || claimed.job.status !== "running") {
    return Response.json({ jobId: job.id, status: claimed?.job.status ?? "queued" }, { status: 409 });
  }
  const tools = createDeniTools({ userId, bot, threadId: thread.id, jobId: job.id });
  let writeRunStatus: ((status: "working" | "finalizing" | "waiting" | "completed" | "failed") => void) | undefined;
  let finalizationPromise: Promise<boolean> | undefined;
  const finalizeChatJob = (text?: string) => {
    if (finalizationPromise) return finalizationPromise;
    // Notify the subscribed Chat before any durable finalization awaits. The event is
    // only emitted for turns that did not end in an approval/takeover wait.
    writeRunStatus?.("finalizing");
    finalizationPromise = (async () => {
      const transitioned = await transitionJob(userId, job.id, "running", {
        status: "finalizing",
        heartbeatAt: new Date(),
      });
      if (!transitioned) {
        const current = await getJob(userId, job.id);
        if (current?.status === "waiting_approval" || current?.status === "waiting_takeover") {
          writeRunStatus?.("waiting");
        } else if (current?.status === "completed") {
          writeRunStatus?.("completed");
        } else if (current?.status === "failed" || current?.status === "cancelled") {
          writeRunStatus?.("failed");
        }
        return false;
      }
      try {
        await setComputer(userId, {
          status: "working",
          workingLabel: "Saving result",
          workingBotId: bot.id,
          jobId: job.id,
        });
        if (text?.trim()) {
          const persistedNow = await loadMessages(userId, thread.id);
          const assistantId = `${job.id}_assistant`;
          if (!persistedNow.some((item) => item.id === assistantId)) {
            await saveMessages(userId, thread.id, [
              ...persistedNow,
              { id: assistantId, role: "assistant", parts: [{ type: "text", text }] },
            ]);
          }
        }
        await setComputer(userId, {
          status: "idle",
          workingLabel: "",
          workingBotId: null,
          jobId: job.id,
        });
        const completed = await finishJob(userId, job.id, "completed", {
          result: { status: "completed" },
        });
        if (!completed) return false;
        writeRunStatus?.("completed");
        await createNotification({
          userId,
          jobId: job.id,
          kind: "completed",
          title: `${bot.name} finished a task`,
          body: "The result is ready in this conversation.",
        }).catch(() => undefined);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeRunStatus?.("failed");
        await finishJob(userId, job.id, "failed", { error: message }).catch(() => undefined);
        await setComputer(userId, {
          status: "idle",
          workingLabel: "",
          workingBotId: null,
          lastError: message,
          jobId: job.id,
        }).catch(() => undefined);
        await createNotification({
          userId,
          jobId: job.id,
          kind: "failed",
          title: `${bot.name} could not save the result`,
          body: message,
        }).catch(() => undefined);
        return false;
      }
    })();
    return finalizationPromise;
  };

  const result = streamText({
    model,
    instructions: buildInstructions(
      bot,
      store.skills,
      store.bots.map((item) => ({
        id: item.id,
        name: item.name,
        job: item.job,
      })),
    ),
    messages: await convertToModelMessages(compactMessagesForModel(messagesWithReplyContext(messages))),
    tools,
    toolApproval: deniToolApproval({ userId, jobId: job.id }),
    stopWhen: isLoopFinished(),
    providerOptions,
    onStepEnd: async (step) => {
      const stepRecord = step as { stepNumber?: number; text?: string };
      const checkpoint = {
        step: stepRecord.stepNumber,
        text: stepRecord.text?.slice(-2_000) ?? "",
        toolCalls: Array.isArray((step as { toolCalls?: unknown[] }).toolCalls)
          ? (step as { toolCalls: unknown[] }).toolCalls.slice(-8)
          : [],
      };
      // Do not hold the provider stream on database bookkeeping. The finish chunk should
      // reach the client as soon as the model step is done; all durable writes continue in
      // the server process and the next tool checks cancellation through setAgentComputer.
      void Promise.allSettled([
        heartbeatJob(userId, job.id),
        checkpointJob(userId, job.id, checkpoint),
        recordTokenUsage(userId, step.usage, { multiplier: tokenMultiplier }),
      ]).then((results) => {
        for (const result of results) {
          if (result.status === "rejected") console.error("persist chat step", result.reason);
        }
      });
      void getJob(userId, job.id).then((current) => {
        if (current?.status === "cancelled") {
          void checkpointJob(userId, job.id, { ...checkpoint, cancelled: true }, "cancelled").catch(
            () => undefined,
          );
        }
      });
    },
    onError: async (event) => {
      reportError(event, "chat");
      if (finalizationPromise) {
        await finalizationPromise.catch(() => undefined);
        return;
      }
      const current = await getJob(userId, job.id);
      if (current?.status === "running") {
        writeRunStatus?.("failed");
        await setComputer(userId, {
          status: "idle",
          workingLabel: "",
          workingBotId: null,
          lastError: "The model call failed",
          jobId: job.id,
        }).catch(() => undefined);
        await finishJob(userId, job.id, "failed", {
          error: event.error instanceof Error ? event.error.message : "The model call failed",
        }).catch(() => undefined);
        await createNotification({
          userId,
          jobId: job.id,
          kind: "failed",
          title: `${bot.name} could not finish the task`,
          body: event.error instanceof Error ? event.error.message : "The model call failed",
        }).catch(() => undefined);
      }
    },
    onFinish: async (event) => {
      if (hasPendingWorkflowWait(event)) {
        writeRunStatus?.("waiting");
        return;
      }
      await finalizeChatJob(event.text).catch((error) => {
        console.error("finalize chat job", error);
      });
    },
  });

  const stream = createUIMessageStream<UIMessage>({
    execute: ({ writer }) => {
      writeRunStatus = (status) => {
        writer.write({
          type: "data-job-status",
          transient: true,
          data: { jobId: job.id, status },
        } as never);
      };
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          originalMessages: messages,
          onEnd: async ({ messages: next }) => {
            if (finalizationPromise) await finalizationPromise.catch(() => undefined);
            await saveMessages(userId, thread.id, next).catch((error) => {
              console.error("save messages", error);
            });
            if (!finalizationPromise && !hasPendingWorkflowWait(next)) {
              await finalizeChatJob(lastAssistantText(next)).catch((error) => {
                console.error("finalize chat job from message stream", error);
              });
            }
          },
        }),
      );
    },
  });
  return createUIMessageStreamResponse({ stream });
}
