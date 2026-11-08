import { convertToModelMessages, generateText, isLoopFinished, type UIMessage } from "ai";
import { buildInstructions, createDeniTools, deniHandoffToolApproval } from "../agent";
import { finishJob, checkpointJob, claimJob, heartbeatJob, getJob } from "./index";
import { getDeniModel, hasLanguageModel } from "../agent/llm";
import { nowIso } from "../data/ids";
import { loadMessages, mutateStore, readStore, saveMessages } from "../data/store";
import { createNotification } from "./notifications";
import { setComputer } from "../computer";
import { assertCanUseTokens, isUsageLimitError, recordModelSteps } from "../billing/usage";
import { messagesForModel } from "../chat/messages";
import { compactThread } from "../agent/compaction";
import { parseRunMode } from "../agent/model";
import type { AgentJob } from "../types";
import { messagesWithReplyContext } from "../chat/message-actions";
import { groupContext } from "../chat/group-chat";
import { translateError, translatorFor } from "../i18n/standalone";
import { BUBBLE_BREAK_METADATA, withoutBubbleBreaks } from "../chat/message-bubbles";

function payloadMessages(job: AgentJob): UIMessage[] {
  const value = job.payload.messages;
  return Array.isArray(value) ? (value as UIMessage[]) : [];
}

/** Renew the lease at least this often while a model call runs (the lease lasts 5 minutes). */
export const JOB_HEARTBEAT_MS = 30_000;

/**
 * Claim one queued job and run it without a request lifecycle (the retry endpoint and
 * Discord), so a browser disconnect cannot terminate the work.
 */
export async function runBackgroundJob(userId: string, jobId: string) {
  const claimed = await claimJob(userId, jobId);
  if (!claimed || !claimed.claimed || claimed.job.status !== "running") return claimed?.job ?? null;
  return runClaimedJob(claimed.job);
}

/**
 * Run a job this process already claimed (the scheduler claims a batch with
 * `claimNextJobs`). A heartbeat renews the lease every {@link JOB_HEARTBEAT_MS} while the
 * model works, each step is checkpointed, and a cancellation seen at a heartbeat or step
 * aborts the model call. The assistant message id is derived from the job id, so a retry
 * replaces the reply instead of adding a second one.
 */
export async function runClaimedJob(job: AgentJob): Promise<AgentJob | null> {
  const userId = job.userId ?? "";
  const locale = typeof job.payload.locale === "string" ? job.payload.locale : undefined;
  const tr = translatorFor(locale);
  const store = await readStore(userId);
  if (!store.threads.some((thread) => thread.id === job.threadId)) {
    await finishJob(userId, job.id, "cancelled", { error: tr("Conversation was deleted") });
    return getJob(userId, job.id);
  }
  if (job.kind === "routine") {
    const routine = store.routines.find((item) => item.id === job.payload.routineId);
    if (!routine?.enabled || (routine.revision ?? 0) !== (job.payload.routineRevision ?? 0)) {
      await finishJob(userId, job.id, "cancelled", {
        error: tr("Routine was disabled, deleted, or changed before this run started."),
      });
      return getJob(userId, job.id);
    }
  }
  const bot = store.bots.find((item) => item.id === job.botId);
  if (!bot) {
    await finishJob(userId, job.id, "failed", { error: tr("bot not found") });
    return getJob(userId, job.id);
  }
  if (!(await hasLanguageModel(userId))) {
    await finishJob(userId, job.id, "failed", { error: tr("OPENROUTER_API_KEY is missing") });
    await createNotification({
      userId,
      jobId: job.id,
      kind: "failed",
      title: tr("Task needs setup"),
      body: tr("Add an OpenRouter API key before retrying this task."),
    }).catch(() => undefined);
    return getJob(userId, job.id);
  }

  const messages = payloadMessages(job);
  const abort = new AbortController();
  const heartbeat = setInterval(() => {
    void heartbeatJob(userId, job.id)
      .then((current) => {
        if (!current) abort.abort();
      })
      .catch(() => undefined);
  }, JOB_HEARTBEAT_MS);
  heartbeat.unref?.();
  const isGroup = store.threads.find((thread) => thread.id === job.threadId)?.kind === "group";
  try {
    await assertCanUseTokens(userId);
    const currentMessages = await loadMessages(userId, job.threadId);
    const latestInput = messages.at(-1);
    if (latestInput && !currentMessages.some((item) => item.id === latestInput.id)) {
      await saveMessages(userId, job.threadId, [latestInput]);
    }
    await setComputer(userId, {
      status: "working",
      workingBotId: bot.id,
      workingLabel: tr("Working in the background"),
      botId: bot.id,
      jobId: job.id,
    });
    const { model, providerOptions, modelId } = await getDeniModel(
      userId,
      typeof job.payload.runMode === "string" ? parseRunMode(job.payload.runMode) : undefined,
    );
    const modelHistory = await compactThread({ userId, threadId: job.threadId, bot, messages });
    const result = await generateText({
      model,
      instructions: buildInstructions(
        bot,
        store.skills,
        store.bots.map((item) => ({ id: item.id, name: item.name, job: item.job })),
      ),
      messages: await convertToModelMessages(
        messagesForModel(
          messagesWithReplyContext(isGroup ? groupContext(modelHistory, bot.id) : modelHistory),
        ),
      ),
      tools: createDeniTools({
        userId,
        bot,
        threadId: job.threadId,
        jobId: job.id,
        allowHandoff: !isGroup,
        locale,
      }),
      // Only a text reply is saved below, so an approval card could never be answered and the
      // job would stay in waiting_approval. Deny those actions; the reply explains what is left.
      toolApproval: deniHandoffToolApproval(
        locale,
        tr("Background tasks cannot wait for approval"),
        userId,
      ),
      stopWhen: isLoopFinished(),
      providerOptions,
      abortSignal: abort.signal,
      onStepFinish: async (step) => {
        await heartbeatJob(userId, job.id).catch(() => undefined);
        await checkpointJob(userId, job.id, {
          step: step.stepNumber,
          text: step.text?.slice(-2_000) ?? "",
          updatedAt: nowIso(),
        }).catch(() => undefined);
        const current = await getJob(userId, job.id);
        if (!current || current.status === "cancelled") {
          abort.abort();
          throw new Error(tr("Job cancelled or conversation deleted"));
        }
      },
    });
    await recordModelSteps(userId, result.steps, modelId);
    const current = await getJob(userId, job.id);
    if (current?.status === "cancelled") return current;
    const assistant: UIMessage = {
      id: `${job.id}_assistant`,
      role: "assistant",
      metadata: {
        ...BUBBLE_BREAK_METADATA,
        author: { id: bot.id, name: bot.name, accent: bot.accent },
        jobId: job.id,
      },
      parts: [{ type: "text", text: result.text || tr("Task completed.") }],
    };
    await saveMessages(userId, job.threadId, [assistant]);
    if (typeof job.payload.routineId === "string") {
      await mutateStore(userId, (next) => {
        const routine = next.routines.find((item) => item.id === job.payload.routineId);
        if (!routine) return;
        routine.lastRunAt = nowIso();
        routine.lastError = null;
      }).catch(() => undefined);
    }
    const completed = await finishJob(userId, job.id, "completed", {
      result: { text: result.text || tr("Task completed."), usage: result.usage },
    });
    if (completed) {
      await createNotification({
        userId,
        jobId: job.id,
        kind: "completed",
        title: tr("{name} finished a task", { name: bot.name }),
        body: withoutBubbleBreaks(result.text ?? "").slice(0, 240) || tr("The task is complete."),
      }).catch(() => undefined);
    }
    return completed;
  } catch (error) {
    const message = translateError(locale, error);
    const usageError = isUsageLimitError(error);
    const current = await getJob(userId, job.id);
    if (current?.status === "cancelled") return current;
    const failed = await finishJob(userId, job.id, "failed", { error: message });
    if (typeof job.payload.routineId === "string") {
      await mutateStore(userId, (next) => {
        const routine = next.routines.find((item) => item.id === job.payload.routineId);
        if (routine) routine.lastError = message;
      }).catch(() => undefined);
    }
    if (failed) {
      await createNotification({
        userId,
        jobId: job.id,
        kind: "failed",
        title: usageError
          ? tr("Task paused by usage limit")
          : tr("{name} could not finish the task", { name: bot.name }),
        body: message,
      }).catch(() => undefined);
    }
    return failed;
  } finally {
    clearInterval(heartbeat);
    await setComputer(userId, {
      status: "idle",
      workingLabel: "",
      workingBotId: null,
      botId: bot.id,
      jobId: job.id,
    }).catch(() => undefined);
  }
}
