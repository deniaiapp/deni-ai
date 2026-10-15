import "@tanstack/react-start/server-only";

import { convertToModelMessages, generateText, isLoopFinished, type UIMessage } from "ai";
import { buildInstructions, createDeniTools, deniHandoffToolApproval, deniToolApproval } from "./agent";
import { getApiKey } from "./config";
import { finishJob, checkpointJob, claimJob, heartbeatJob, getJob } from "./jobs";
import { getDeniModel } from "./llm";
import { nowIso } from "./ids";
import { loadMessages, mutateStore, readStore, saveMessages } from "./store";
import { createNotification } from "./notifications";
import { setComputer } from "./computer";
import { assertCanUseTokens, isUsageLimitError, recordTokenUsage } from "./usage";
import { compactMessagesForModel } from "./messages";
import { parseRunMode } from "./model";
import type { AgentJob } from "./types";
import { messagesWithReplyContext } from "./message-actions";
import { groupContext } from "./group-chat";
import { translateError, translatorFor } from "./i18n-server";
import { BUBBLE_BREAK_METADATA, withoutBubbleBreaks } from "./message-bubbles";

function payloadMessages(job: AgentJob): UIMessage[] {
  const value = job.payload.messages;
  return Array.isArray(value) ? (value as UIMessage[]) : [];
}


/**
 * Execute a queued job without a request lifecycle. This is used by the scheduler and
 * retry endpoint, so a browser disconnect cannot terminate the work. The DB lease makes
 * concurrent scheduler ticks and process restarts safe.
 */
export async function runBackgroundJob(userId: string, jobId: string) {
  const claimed = await claimJob(userId, jobId);
  if (!claimed || !claimed.claimed || claimed.job.status !== "running") return claimed?.job ?? null;
  const job = claimed.job;
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
      await finishJob(userId, job.id, "cancelled", { error: tr("Routine was disabled, deleted, or changed before this run started.") });
      return getJob(userId, job.id);
    }
  }
  const bot = store.bots.find((item) => item.id === job.botId);
  if (!bot) {
    await finishJob(userId, job.id, "failed", { error: tr("bot not found") });
    return getJob(userId, job.id);
  }
  const apiKey = await getApiKey(userId);
  if (!apiKey) {
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
    const { model, providerOptions, tokenMultiplier } = await getDeniModel(
      userId,
      typeof job.payload.runMode === "string" ? parseRunMode(job.payload.runMode) : undefined,
    );
    const result = await generateText({
      model,
      instructions: buildInstructions(
        bot,
        store.skills,
        store.bots.map((item) => ({ id: item.id, name: item.name, job: item.job })),
      ),
      messages: await convertToModelMessages(compactMessagesForModel(messagesWithReplyContext(isGroup ? groupContext(messages, bot.id) : messages))),
      tools: createDeniTools({ userId, bot, threadId: job.threadId, jobId: job.id, allowHandoff: !isGroup, locale }),
      toolApproval:
        job.kind === "routine"
          ? deniHandoffToolApproval(locale)
          : deniToolApproval({ userId, jobId: job.id, locale }),
      stopWhen: isLoopFinished(),
      providerOptions,
      onStepFinish: async (step) => {
        await heartbeatJob(userId, job.id).catch(() => undefined);
        await checkpointJob(userId, job.id, {
          step: step.stepNumber,
          text: step.text?.slice(-2_000) ?? "",
          updatedAt: nowIso(),
        }).catch(() => undefined);
        const current = await getJob(userId, job.id);
        if (!current || current.status === "cancelled") throw new Error(tr("Job cancelled or conversation deleted"));
      },
    });
    await recordTokenUsage(userId, result.usage, { multiplier: tokenMultiplier });
    const current = await getJob(userId, job.id);
    if (current?.status === "cancelled") return current;
    const assistant: UIMessage = {
      id: `${job.id}_assistant`,
      role: "assistant",
      metadata: { ...BUBBLE_BREAK_METADATA, author: { id: bot.id, name: bot.name, accent: bot.accent }, jobId: job.id },
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
        title: usageError ? tr("Task paused by usage limit") : tr("{name} could not finish the task", { name: bot.name }),
        body: message,
      }).catch(() => undefined);
    }
    return failed;
  } finally {
    await setComputer(userId, {
      status: "idle",
      workingLabel: "",
      workingBotId: null,
      botId: bot.id,
      jobId: job.id,
    }).catch(() => undefined);
  }
}
