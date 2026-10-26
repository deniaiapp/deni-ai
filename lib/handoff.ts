import "@tanstack/react-start/server-only";

import { convertToModelMessages, isStepCount, streamText, type UIMessage } from "ai";
import { createId, nowIso } from "./ids";
import { getDeniModel } from "./llm";
import { messagesForModel } from "./messages";
import { loadMessages, mutateStore, readStore, saveMessages } from "./store";
import type { HandoffSnapshot, HandoffStep } from "./types";
import { translateError, translateMessage, translatorFor } from "./i18n-server";
import { assertCanUseTokens, isUsageLimitError, recordModelUsage } from "./usage";
import { BUBBLE_BREAK_METADATA, withoutBubbleBreaks } from "./message-bubbles";

type HandoffRun = HandoffSnapshot & { userId: string; locale?: string };

const g = globalThis as typeof globalThis & {
  __deniHandoffs?: Map<string, HandoffRun>;
};

function handoffs() {
  if (!g.__deniHandoffs) g.__deniHandoffs = new Map();
  return g.__deniHandoffs;
}

function snapshotOf(run: HandoffRun): HandoffSnapshot {
  const { userId: _userId, locale: _locale, ...rest } = run;
  return rest;
}

export async function getHandoff(userId: string, id: string): Promise<HandoffSnapshot | null> {
  const run = handoffs().get(id);
  if (run && run.userId === userId) return snapshotOf(run);
  const store = await readStore(userId);
  return store.handoffs?.find((item) => item.id === id) ?? null;
}

export async function listHandoffs(userId: string): Promise<HandoffSnapshot[]> {
  const live = [...handoffs().values()]
    .filter((run) => run.userId === userId)
    .map(snapshotOf);
  const store = await readStore(userId);
  const saved = store.handoffs ?? [];
  const byId = new Map<string, HandoffSnapshot>();
  for (const item of [...saved, ...live]) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt);
}

async function persistHandoff(run: HandoffRun) {
  const snapshot = snapshotOf(run);
  await mutateStore(run.userId, (store) => {
    store.handoffs ??= [];
    const index = store.handoffs.findIndex((item) => item.id === run.id);
    if (index >= 0) store.handoffs[index] = snapshot;
    else store.handoffs.unshift(snapshot);
    store.handoffs = store.handoffs.slice(0, 40);
  }).catch(() => undefined);
}

function publish(run: HandoffRun, patch: Partial<HandoffRun>) {
  Object.assign(run, patch);
  handoffs().set(run.id, run);
  if (run.status !== "running") void persistHandoff(run);
}

function addStep(run: HandoffRun, step: HandoffStep) {
  const steps = [...run.steps];
  const last = steps.at(-1);
  if (last && last.kind === step.kind && last.label === step.label && last.status === "active") {
    steps[steps.length - 1] = { ...last, ...step };
  } else {
    if (last?.status === "active") last.status = "complete";
    steps.push(step);
  }
  run.steps = steps.slice(-24);
}

export async function startHandoff(opts: {
  userId: string;
  fromBotId: string;
  fromBotName: string;
  targetBotId: string;
  message: string;
  locale?: string;
}) {
  const tr = translatorFor(opts.locale);
  const store = await readStore(opts.userId);
  const target = store.bots.find((item) => item.id === opts.targetBotId);
  if (!target) return { error: tr("bot not found") };
  const thread =
    store.threads.find((item) => item.kind === "dm" && item.botIds.includes(opts.targetBotId)) ??
    null;
  if (!thread) return { error: tr("dm not found") };

  const existing = await loadMessages(opts.userId, thread.id);
  const note: UIMessage = {
    id: createId("msg"),
    role: "user",
    parts: [
      {
        type: "text",
        text: `${tr("[Handoff from {name}]", { name: opts.fromBotName })}\n${opts.message}`,
      },
    ],
  };
  const messages = [...existing, note];
  await saveMessages(opts.userId, thread.id, [note]);
  await mutateStore(opts.userId, (next) => {
    const item = next.threads.find((entry) => entry.id === thread.id);
    if (!item) return;
    item.unread = true;
    item.updatedAt = nowIso();
  });

  try {
    await assertCanUseTokens(opts.userId);
  } catch (error) {
    if (isUsageLimitError(error)) {
      return { error: translateMessage(opts.locale, error.message), deliveredTo: target.name, threadId: thread.id };
    }
    throw error;
  }

  const run: HandoffRun = {
    id: createId("hdo"),
    userId: opts.userId,
    locale: opts.locale,
    fromBotId: opts.fromBotId,
    fromBotName: opts.fromBotName,
    targetBotId: target.id,
    targetName: target.name,
    threadId: thread.id,
    status: "running",
    currentLabel: tr("Starting"),
    steps: [],
    reply: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  handoffs().set(run.id, run);
  void persistHandoff(run);
  void executeHandoff(run, messages).catch((error) => {
    publish(run, {
      status: "error",
      error: translateError(opts.locale, error),
      currentLabel: tr("Failed"),
      finishedAt: Date.now(),
    });
  });

  return {
    handoffId: run.id,
    deliveredTo: target.name,
    threadId: thread.id,
    status: "running" as const,
    instruction:
      "The teammate is working in the background. Keep doing other work. Call handoffStatus to read their thinking and tool use.",
  };
}

async function executeHandoff(run: HandoffRun, messages: UIMessage[]) {
  const { buildInstructions, createDeniTools, deniHandoffToolApproval } = await import("./agent");
  const tr = translatorFor(run.locale);
  const store = await readStore(run.userId);
  const target = store.bots.find((item) => item.id === run.targetBotId);
  if (!target) {
    publish(run, { status: "error", error: tr("bot not found"), finishedAt: Date.now() });
    return;
  }

  const { model, providerOptions, modelId } = await getDeniModel(run.userId);
  const result = streamText({
    model,
    instructions: `${buildInstructions(
      target,
      store.skills,
      store.bots.map((item) => ({
        id: item.id,
        name: item.name,
        job: item.job,
      })),
    )}

This is a handoff from ${run.fromBotName}. Complete the work and report back concisely. Do not hand the work off again.`,
    messages: await convertToModelMessages(messagesForModel(messages)),
    tools: createDeniTools({
      userId: run.userId,
      bot: target,
      threadId: run.threadId,
      allowHandoff: false,
      locale: run.locale,
    }),
    toolApproval: deniHandoffToolApproval(run.locale, undefined, run.userId),
    stopWhen: isStepCount(16),
    timeout: { totalMs: 180_000, stepMs: 45_000 },
    providerOptions,
    onStepStart: () => {
      publish(run, { currentLabel: tr("Thinking") });
      addStep(run, { kind: "thinking", label: tr("Thinking"), status: "active" });
    },
    onStepEnd: async (step) => {
      await recordModelUsage(run.userId, step, modelId).catch(() => undefined);
      if (step.reasoningText?.trim()) {
        addStep(run, {
          kind: "thinking",
          label: splitTitle(step.reasoningText, tr("Thinking")),
          detail: step.reasoningText.trim().slice(0, 1_200),
          status: "complete",
        });
      }
      for (const call of step.toolCalls ?? []) {
        if (!call) continue;
        addStep(run, {
          kind: "tool",
          label: call.toolName,
          detail: toolDetail(call.input),
          status: "complete",
        });
      }
      if (step.text?.trim()) publish(run, { currentLabel: tr("Writing") });
    },
  });

  const text = await result.text;
  const reply = text.trim() || tr("Finished without a written report.");
  const assistant: UIMessage = {
    id: `${run.id}_assistant`,
    role: "assistant",
    metadata: { ...BUBBLE_BREAK_METADATA, author: { id: target.id, name: target.name, accent: target.accent } },
    parts: [{ type: "text", text: reply }],
  };
  await saveMessages(run.userId, run.threadId, [assistant]);
  publish(run, {
    status: "done",
    reply: withoutBubbleBreaks(reply),
    currentLabel: tr("Done"),
    finishedAt: Date.now(),
  });
}

function splitTitle(text: string, fallback: string) {
  const match = text.trimStart().match(/^\*\*(.+?)\*\*/);
  return match?.[1]?.trim() || fallback;
}

function toolDetail(input: unknown) {
  if (!input || typeof input !== "object") return undefined;
  const rec = input as Record<string, unknown>;
  for (const key of ["command", "path", "url", "action", "name", "text"]) {
    const value = rec[key];
    if (typeof value === "string" && value.trim()) return value.slice(0, 160);
  }
  return undefined;
}
