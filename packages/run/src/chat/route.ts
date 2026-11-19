import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isLoopFinished,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { buildInstructions, createDeniTools, deniToolApproval } from "../agent";
import { setComputer } from "../computer";
import { getDeniModel, hasLanguageModel } from "../agent/llm";
import { runLogger } from "../runtime";
import { parseRunMode } from "../agent/model";
import { loadMessages, mutateStore, readStore, saveMessages } from "../data/store";
import { assertCanUseTokens, isUsageLimitError, recordModelUsage } from "../billing/usage";
import { messagesForModel, mergeThreadMessages, workedMsOf } from "../chat/messages";
import { compactThread } from "../agent/compaction";
import {
  checkpointJob,
  claimJob,
  createClaimedJob,
  finishJob,
  getJob,
  getJobByIdempotencyKey,
  heartbeatJob,
  transitionJob,
  updateJob,
} from "../jobs";
import { createNotification } from "../jobs/notifications";
import { hasOpenApproval, hasPendingWorkflowWait } from "../chat/run-state";
import { releaseStaleApproval } from "../jobs/actions";
import { messagesWithReplyContext, resolveReplyReferences } from "../chat/message-actions";
import { releaseBrowserTakeover } from "../computer/browser-workspaces";
import { createHash } from "node:crypto";
import { groupContext } from "../chat/group-chat";
import {
  translateError,
  translateMessage,
  translatorFor,
  type Translate,
} from "../i18n/standalone";
import { usageLimitResponse } from "../i18n/localize-error";
import { BUBBLE_BREAK_METADATA } from "../chat/message-bubbles";

function reportError(error: unknown, context: string) {
  runLogger().error(`[run] ${context}`, error);
}

function jobConflict(t: Translate, job: { id: string; status: string }) {
  const message =
    job.status === "waiting_approval"
      ? t("Please approve or deny the pending action before continuing.")
      : job.status === "waiting_takeover"
        ? t("Finish the step on the computer, then send a new message to continue.")
        : job.status === "uncertain"
          ? t("Review the previous run before retrying it.")
          : t("This task is already running or this message has already been submitted.");
  return new Response(message, {
    status: 409,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Deni-Job-Id": job.id,
      "X-Deni-Job-Status": job.status,
    },
  });
}

function includesApprovalResponse(incoming: UIMessage[], persisted: UIMessage[]) {
  const pending = new Set<string>();
  for (const message of persisted)
    for (const part of message.parts) {
      const value = part as { state?: string; approval?: { id?: string } };
      if (value.state === "approval-requested" && value.approval?.id)
        pending.add(value.approval.id);
    }
  return incoming.some(
    (message) =>
      message.role === "assistant" &&
      message.parts.some((part) => {
        const value = part as { state?: string; approval?: { id?: string; approved?: boolean } };
        return (
          value.state === "approval-responded" &&
          value.approval?.id &&
          pending.has(value.approval.id) &&
          typeof value.approval.approved === "boolean"
        );
      }),
  );
}

/**
 * The Run streaming endpoint (POST /api/run/chat in the web app), used with the AI SDK
 * `useChat` transport. The host authenticates and rate-limits; `ctx.userId` is the
 * Deni AI user. Group chats call it once per teammate to collect each reply.
 *
 * Request body (JSON):
 * - `threadId` (or `id`, the useChat chat id): the Run thread.
 * - `messages`: the UIMessages the client holds (only the new input and, after an
 *   approval, the answered assistant message matter; history is read from the database).
 * - `botId`: the teammate that answers (default: the thread's first teammate).
 * - `idempotencyKey`: optional; a resubmitted message with the same key is refused (409).
 * - `jobId`: optional; resume this job after an approval or a takeover.
 * - `runMode`: optional Run mode (`default`, `high`, ... `plus-max`); saved as the default.
 *
 * Responses: a UI message stream (with transient `data-job-status` parts), 404 for an
 * unknown thread or teammate, 409 (`X-Deni-Job-Id`, `X-Deni-Job-Status`) while a job
 * already runs or waits, 402 JSON `{ error, code: "usage_limit", metric }` with the
 * `x-usage-limit` header, 503 JSON `{ error, code: "llm_unconfigured" }` without an
 * OpenRouter key.
 */
export async function handleChat(
  req: Request,
  ctx: { userId: string; locale: "en" | "ja" },
): Promise<Response> {
  const { userId, locale } = ctx;
  const t = translatorFor(locale);
  const body = (await req.json().catch(() => ({}))) as {
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
    return new Response(t("Conversation not found."), { status: 404 });
  }

  const botId = body.botId || thread.botIds[0];
  const bot = store.bots.find((item) => item.id === botId);
  if (!bot || !thread.botIds.includes(bot.id)) {
    return new Response(t("Teammate not found"), { status: 404 });
  }

  if (!(await hasLanguageModel(userId))) {
    return Response.json(
      {
        error: t("Run is not connected to a language model on this server yet."),
        code: "llm_unconfigured",
      },
      { status: 503 },
    );
  }

  try {
    await assertCanUseTokens(userId);
  } catch (error) {
    if (isUsageLimitError(error)) {
      return usageLimitResponse(userId, error, locale);
    }
    throw error;
  }

  let incoming = body.messages ?? [];
  const persisted = await loadMessages(userId, thread.id);
  try {
    incoming = resolveReplyReferences(incoming, persisted);
  } catch {
    return Response.json(
      { error: t("The message you replied to is no longer available.") },
      { status: 400 },
    );
  }
  const messages = mergeThreadMessages(persisted, incoming);
  const runMode = parseRunMode(body.runMode ?? store.config.runMode);
  if (body.runMode && runMode !== store.config.runMode) {
    await mutateStore(userId, (next) => {
      next.config.runMode = runMode;
    });
  }

  const { model, providerOptions, modelId } = await getDeniModel(userId, runMode);
  const idempotencyKey =
    body.idempotencyKey?.trim() || `chat:${thread.id}:${incoming.at(-1)?.id || Date.now()}`;
  const resumeCandidate = body.jobId ? await getJob(userId, body.jobId) : null;
  let job =
    resumeCandidate && resumeCandidate.threadId === thread.id && resumeCandidate.botId === bot.id
      ? resumeCandidate
      : null;
  const input = incoming.at(-1);
  const previousMessages = job?.payload.messages;
  const previousInputs = Array.isArray(previousMessages) ? (previousMessages as UIMessage[]) : [];
  const previousInput = previousInputs.findLast((message) => message.role === "user");
  const hasNewInput =
    input?.role === "user" &&
    Boolean(input.id) &&
    input.id !== previousInput?.id &&
    input.parts.some((part) => part.type === "text" && part.text.trim());
  // A just-completed job can remain in a client's polling snapshot briefly.
  if (job && ["completed", "failed", "cancelled"].includes(job.status) && hasNewInput) job = null;
  const continuationFrom =
    job?.status === "waiting_takeover" && hasNewInput
      ? "waiting_takeover"
      : job?.status === "waiting_approval" && includesApprovalResponse(incoming, persisted)
        ? "waiting_approval"
        : undefined;
  if (
    job?.status === "waiting_approval" &&
    !continuationFrom &&
    !hasOpenApproval(persisted, job.id)
  ) {
    if (await releaseStaleApproval(userId, job.id)) job = null;
  }
  if (job && job.status !== "queued" && !continuationFrom) {
    return jobConflict(t, job);
  }
  // A new job is created already claimed. Created as queued, the background scheduler could take
  // it before this request claimed it, and the reply would run in the background.
  let createdClaimed = false;
  if (!job) {
    const existing = await getJobByIdempotencyKey(userId, idempotencyKey);
    if (existing && existing.status !== "failed" && existing.status !== "cancelled") {
      return jobConflict(t, existing);
    }
    const created = await createClaimedJob({
      userId,
      threadId: thread.id,
      botId: bot.id,
      kind: "chat",
      idempotencyKey,
      payload: { messages, runMode, locale },
    });
    if (!created.claimed) return jobConflict(t, created.job);
    job = created.job;
    createdClaimed = true;
  }
  if (resumeCandidate && job && !continuationFrom && !createdClaimed) {
    job =
      (await updateJob(userId, job.id, {
        payload: { ...job.payload, messages, runMode, locale },
      })) ?? job;
  }
  // Claim a waiting continuation with its updated input atomically. It is never
  // exposed as queued with old input for the background worker to pick up.
  if (!continuationFrom) await saveMessages(userId, thread.id, incoming);
  const claimed = createdClaimed
    ? { job, claimed: true }
    : await claimJob(
        userId,
        job.id,
        continuationFrom
          ? {
              from: continuationFrom,
              threadId: thread.id,
              botId: bot.id,
              key: idempotencyKey,
              payload: { messages, runMode, locale },
            }
          : undefined,
      );
  if (!claimed || !claimed.claimed || claimed.job.status !== "running") {
    return jobConflict(t, claimed?.job ?? job);
  }
  if (continuationFrom) {
    try {
      if (continuationFrom === "waiting_takeover") {
        await releaseBrowserTakeover(userId, job.id);
        await setComputer(userId, {
          status: "idle",
          workingLabel: "",
          workingBotId: null,
          jobId: job.id,
        });
      }
      await saveMessages(userId, thread.id, incoming);
    } catch (error) {
      await transitionJob(userId, job.id, "running", {
        status: continuationFrom,
        payload: job.payload,
        lockedAt: null,
        heartbeatAt: null,
      });
      reportError(error, "resume chat");
      return new Response(t("Could not resume the task. Please send your message again."), {
        status: 503,
      });
    }
  }
  job = claimed.job;
  const approvalMessage =
    continuationFrom === "waiting_approval"
      ? incoming.findLast((message) => message.role === "assistant")
      : undefined;
  const assistantId =
    approvalMessage?.id ||
    `${job.id}_assistant_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 12)}`;
  const author = { id: bot.id, name: bot.name, accent: bot.accent };
  // A reply resumed after an approval keeps counting from the time already worked on it.
  const runStartedAt = Date.now();
  const workedBefore = workedMsOf(approvalMessage) ?? 0;
  const requestMessage = approvalMessage ?? incoming.findLast((message) => message.role === "user");
  // Concurrent group replies may already follow this input in stored history.
  // The UI stream must still create this bot's own answer, not continue theirs.
  const streamHistory = requestMessage
    ? [...messages.filter((message) => message.id !== requestMessage.id), requestMessage]
    : messages;
  const modelHistory = await compactThread({ userId, threadId: thread.id, bot, messages });
  // A new turn starts from a clean slate: an error left by an earlier run would otherwise stay
  // on the computer panel until the computer next did something.
  if (store.computer.lastError)
    void setComputer(userId, { lastError: null }).catch(() => undefined);
  const tools = createDeniTools({
    userId,
    bot,
    threadId: thread.id,
    jobId: job.id,
    allowHandoff: thread.kind !== "group",
    locale,
  });
  let writeRunStatus:
    | ((status: "working" | "finalizing" | "waiting" | "completed" | "failed") => void)
    | undefined;
  let finalizationPromise: Promise<boolean> | undefined;
  const finalizeChatJob = () => {
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
          workingLabel: t("Saving result"),
          workingBotId: bot.id,
          jobId: job.id,
        });
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
          title: t("{name} finished a task", { name: bot.name }),
          body: t("The result is ready in this conversation."),
        }).catch(() => undefined);
        return true;
      } catch (error) {
        const message = translateError(locale, error);
        writeRunStatus?.("failed");
        await finishJob(userId, job.id, "failed", { error: message }).catch(() => undefined);
        // A failed save is the chat's error, shown there and in the notification, not the computer's.
        await setComputer(userId, {
          status: "idle",
          workingLabel: "",
          workingBotId: null,
          jobId: job.id,
        }).catch(() => undefined);
        await createNotification({
          userId,
          jobId: job.id,
          kind: "failed",
          title: t("{name} could not save the result", { name: bot.name }),
          body: message,
        }).catch(() => undefined);
        return false;
      }
    })();
    return finalizationPromise;
  };

  const result = streamText({
    model,
    instructions:
      buildInstructions(
        bot,
        store.skills,
        store.bots.map((item) => ({
          id: item.id,
          name: item.name,
          job: item.job,
        })),
      ) +
      (thread.kind === "group"
        ? `\nYou are speaking as ${bot.name} in a group chat. Respond only as yourself, from your role. Other teammates may answer in parallel; do not impersonate them or start extra handoffs for this group message.`
        : ""),
    messages: await convertToModelMessages(
      messagesForModel(
        messagesWithReplyContext(
          thread.kind === "group" ? groupContext(modelHistory, bot.id) : modelHistory,
        ),
      ),
    ),
    tools,
    toolApproval: deniToolApproval({ userId, jobId: job.id, locale }),
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
        recordModelUsage(userId, step, modelId),
      ]).then((results) => {
        for (const result of results) {
          if (result.status === "rejected") reportError(result.reason, "persist chat step");
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
        // A failed model call is the chat's error, shown there and in the notification, not the computer's.
        await setComputer(userId, {
          status: "idle",
          workingLabel: "",
          workingBotId: null,
          jobId: job.id,
        }).catch(() => undefined);
        await finishJob(userId, job.id, "failed", {
          error:
            event.error instanceof Error
              ? translateMessage(locale, event.error.message)
              : t("The model call failed"),
        }).catch(() => undefined);
        await createNotification({
          userId,
          jobId: job.id,
          kind: "failed",
          title: t("{name} could not finish the task", { name: bot.name }),
          body:
            event.error instanceof Error
              ? translateMessage(locale, event.error.message)
              : t("The model call failed"),
        }).catch(() => undefined);
      }
    },
    onFinish: async (event) => {
      if (hasPendingWorkflowWait(event)) {
        writeRunStatus?.("waiting");
        return;
      }
      // Persist the one canonical streamed answer in onEnd before completing the job.
      writeRunStatus?.("finalizing");
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
      writeRunStatus("working");
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          originalMessages: streamHistory,
          generateMessageId: () => assistantId,
          messageMetadata: ({ part }) =>
            part.type === "finish"
              ? {
                  ...BUBBLE_BREAK_METADATA,
                  author,
                  jobId: job.id,
                  workedMs: workedBefore + Date.now() - runStartedAt,
                }
              : { ...BUBBLE_BREAK_METADATA, author, jobId: job.id },
          onEnd: async ({ messages: next, isAborted }) => {
            const response = next.find((message) => message.id === assistantId);
            try {
              if (response)
                await saveMessages(userId, thread.id, [
                  {
                    ...response,
                    metadata: {
                      ...(response.metadata as object | undefined),
                      ...BUBBLE_BREAK_METADATA,
                      author,
                      jobId: job.id,
                    },
                  },
                ]);
              if (isAborted) {
                await finishJob(userId, job.id, "cancelled");
                writeRunStatus?.("failed");
                return;
              }
              if (response && hasPendingWorkflowWait(response)) {
                writeRunStatus?.("waiting");
                return;
              }
              await finalizeChatJob();
            } catch (error) {
              reportError(error, "save chat response");
              // deniToolApproval may already have parked the job, but the unsaved card can never
              // be answered, so the wait has to end here too.
              await transitionJob(
                userId,
                job.id,
                ["running", "finalizing", "waiting_approval", "waiting_takeover"],
                {
                  status: "failed",
                  error: t("Could not save the response"),
                  finishedAt: new Date(),
                  heartbeatAt: null,
                  lockedAt: null,
                },
              ).catch(() => undefined);
              writeRunStatus?.("failed");
            }
          },
        }),
      );
    },
  });
  return createUIMessageStreamResponse({ stream });
}
