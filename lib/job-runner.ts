import "server-only";

import { convertToModelMessages, generateText, isLoopFinished, type UIMessage } from "ai";
import { buildInstructions, createDeniTools, deniHandoffToolApproval, deniToolApproval } from "./agent";
import { getApiKey } from "./config";
import { finishJob, checkpointJob, claimJob, heartbeatJob, getJob } from "./jobs";
import { getDeniModel } from "./llm";
import { createId, nowIso } from "./ids";
import { loadMessages, mutateStore, readStore, saveMessages } from "./store";
import { createNotification } from "./notifications";
import { setComputer } from "./computer";
import { assertCanUseTokens, isUsageLimitError, recordTokenUsage } from "./usage";
import { compactMessagesForModel } from "./messages";
import { parseRunMode } from "./model";
import type { AgentJob } from "./types";
import { messagesWithReplyContext } from "./message-actions";

function payloadMessages(job: AgentJob): UIMessage[] {
  const value = job.payload.messages;
  return Array.isArray(value) ? (value as UIMessage[]) : [];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
  const store = await readStore(userId);
  if (job.kind === "routine") {
    const routine = store.routines.find((item) => item.id === job.payload.routineId);
    if (!routine?.enabled || (routine.revision ?? 0) !== (job.payload.routineRevision ?? 0)) {
      await finishJob(userId, job.id, "cancelled", { error: "Routine was disabled, deleted, or changed before this run started." });
      return getJob(userId, job.id);
    }
  }
  const bot = store.bots.find((item) => item.id === job.botId);
  if (!bot) {
    await finishJob(userId, job.id, "failed", { error: "bot not found" });
    return getJob(userId, job.id);
  }
  const apiKey = await getApiKey(userId);
  if (!apiKey) {
    await finishJob(userId, job.id, "failed", { error: "OPENROUTER_API_KEY is missing" });
    await createNotification({
      userId,
      jobId: job.id,
      kind: "failed",
      title: "Task needs setup",
      body: "Add an OpenRouter API key before retrying this task.",
    }).catch(() => undefined);
    return getJob(userId, job.id);
  }

  const messages = payloadMessages(job);
  try {
    await assertCanUseTokens(userId);
    const currentMessages = await loadMessages(userId, job.threadId);
    const latestInput = messages.at(-1);
    if (latestInput && !currentMessages.some((item) => item.id === latestInput.id)) {
      await saveMessages(userId, job.threadId, [...currentMessages, ...messages]);
    }
    await setComputer(userId, {
      status: "working",
      workingBotId: bot.id,
      workingLabel: "Working in the background",
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
      messages: await convertToModelMessages(compactMessagesForModel(messagesWithReplyContext(messages))),
      tools: createDeniTools({ userId, bot, threadId: job.threadId, jobId: job.id }),
      toolApproval:
        job.kind === "routine"
          ? deniHandoffToolApproval()
          : deniToolApproval({ userId, jobId: job.id }),
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
        if (current?.status === "cancelled") throw new Error("Job cancelled by user");
      },
    });
    await recordTokenUsage(userId, result.usage, { multiplier: tokenMultiplier });
    const current = await getJob(userId, job.id);
    if (current?.status === "cancelled") return current;
    const assistant: UIMessage = {
      id: createId("msg"),
      role: "assistant",
      parts: [{ type: "text", text: result.text || "Task completed." }],
    };
    const previous = await loadMessages(userId, job.threadId);
    const hasSame = previous.some((item) => item.id === assistant.id);
    if (!hasSame) await saveMessages(userId, job.threadId, [...previous, assistant]);
    if (typeof job.payload.routineId === "string") {
      await mutateStore(userId, (next) => {
        const routine = next.routines.find((item) => item.id === job.payload.routineId);
        if (!routine) return;
        routine.lastRunAt = nowIso();
        routine.lastError = null;
      }).catch(() => undefined);
    }
    const completed = await finishJob(userId, job.id, "completed", {
      result: { text: result.text || "Task completed.", usage: result.usage },
    });
    if (completed) {
      await createNotification({
        userId,
        jobId: job.id,
        kind: "completed",
        title: `${bot.name} finished a task`,
        body: result.text?.slice(0, 240) || "The task is complete.",
      }).catch(() => undefined);
    }
    return completed;
  } catch (error) {
    const message = errorMessage(error);
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
        title: usageError ? "Task paused by usage limit" : `${bot.name} could not finish the task`,
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
