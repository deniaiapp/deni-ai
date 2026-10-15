import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";
import {
  convertToModelMessages,
  isLoopFinished,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { buildInstructions, createDeniTools, deniToolApproval } from "./agent";
import { getApiKey } from "./config";
import { releaseBrowserTakeover } from "./browser-workspaces";
import { setComputer } from "./computer";
import { hasPendingWorkflowWait } from "./chat-run-state";
import { discordErrorText, discordTranslator as translatorFor } from "./discord-i18n";
import { translateError } from "./i18n-server";
import {
  checkpointJob,
  claimJob,
  createJob,
  finishJob,
  getJob,
  getJobByIdempotencyKey,
  heartbeatJob,
  listJobs,
  transitionJob,
} from "./jobs";
import { getDeniModel } from "./llm";
import { groupContext, groupRecipients } from "./group-chat";
import { discordTargetGroup, groupMembers } from "./groups";
import { compactMessagesForModel, mergeThreadMessages } from "./messages";
import { messagesWithReplyContext } from "./message-actions";
import { parseRunMode } from "./model";
import { createNotification } from "./notifications";
import { assertRateLimit, RateLimitError } from "./rate-limit";
import { reportError } from "./report";
import { loadMessages, readStore, saveMessages } from "./store";
import { resetThreadContext } from "./thread-context";
import type { AgentJob, Bot, Store, Thread } from "./types";
import { assertCanUseTokens, recordTokenUsage } from "./usage";

/** What the Discord layer should show after a turn. It never needs to know about jobs or UI messages. */
export type PendingApproval = { tool: string; summary: string; truncated: boolean };

/** Longest request body shown in Discord. Anything longer must be reviewed in the app. */
export const APPROVAL_SUMMARY_LIMIT = 600;

export type TurnOutcome =
  | { kind: "reply"; botName: string; text: string }
  | { kind: "approval"; botName: string; jobId: string; round: string; pending: PendingApproval[]; text: string }
  | { kind: "takeover"; botName: string; text: string }
  | { kind: "notice"; text: string }
  | { kind: "none" };

const ACTIVE = ["queued", "running", "finalizing", "waiting_approval", "waiting_takeover"];

type ToolPart = {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  approval?: { id: string; approved?: boolean; isAutomatic?: boolean; requestReason?: string; reason?: string };
};

const isToolPart = (part: { type: string }) => part.type.startsWith("tool-") || part.type === "dynamic-tool";

function pendingApprovalParts(message: UIMessage) {
  return (message.parts as unknown as ToolPart[]).filter(
    (part) => isToolPart(part) && part.state === "approval-requested" && Boolean(part.approval?.id) && !part.approval?.isAutomatic,
  );
}

function toolName(part: ToolPart) {
  return part.type === "dynamic-tool" ? (part.toolName ?? "tool") : part.type.slice("tool-".length);
}

function summarize(input: unknown) {
  let text: string;
  try {
    text = typeof input === "string" ? input : JSON.stringify(input);
  } catch {
    text = String(input);
  }
  const shown = (text ?? "").replace(/```/g, "'''");
  return { summary: shown.slice(0, APPROVAL_SUMMARY_LIMIT), truncated: shown.length > APPROVAL_SUMMARY_LIMIT };
}

/** Identifies one round of approval requests so a button from an earlier round cannot answer a later one. */
export function approvalRound(message: UIMessage) {
  const ids = pendingApprovalParts(message).map((part) => part.approval?.id ?? "").sort();
  return createHash("sha256").update(ids.join("|")).digest("hex").slice(0, 8);
}

/** The closing text of a turn: everything after the last tool call, not the running commentary. */
function finalText(message: UIMessage | undefined) {
  if (!message) return "";
  const tail: string[] = [];
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (part.type === "text") tail.unshift(part.text);
    else if (isToolPart(part)) break;
  }
  const text = tail.join("").trim();
  if (text) return text;
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n").trim();
}

export function approvalOutcome(message: UIMessage, jobId: string, bot: Pick<Bot, "name">, locale?: string): TurnOutcome {
  const tr = translatorFor(locale);
  const pending = pendingApprovalParts(message).map((part) => ({ tool: toolName(part), ...summarize(part.input) }));
  return {
    kind: "approval",
    botName: bot.name,
    jobId,
    round: approvalRound(message),
    pending,
    text: tr("{name} needs your approval before continuing.", { name: bot.name }),
  };
}

function pickBot(store: Store, botId: string | null) {
  const bot = store.bots.find((item) => item.id === botId) ?? store.bots[0];
  if (!bot) return null;
  const thread = store.threads.find((item) => item.kind === "dm" && item.botIds[0] === bot.id);
  return thread ? { bot, thread } : null;
}

/** The group plain DMs go to, if the person chose one with /group talk and it still exists. */
function pickGroup(store: Store) {
  const thread = discordTargetGroup(store);
  return thread ? { thread, members: groupMembers(store, thread) } : null;
}

// Matches the web group chat, so a teammate behaves the same wherever the group message came from.
const groupNote = (name: string) =>
  `\nYou are speaking as ${name} in a group chat. Respond only as yourself, from your role. Other teammates may answer in parallel; do not impersonate them or start extra handoffs for this group message.`;

type TurnInput = {
  userId: string;
  locale: string;
  store: Store;
  bot: Bot;
  thread: Thread;
  job: AgentJob;
  messages: UIMessage[];
  requestMessage: UIMessage;
  assistantId: string;
  runMode: ReturnType<typeof parseRunMode>;
};

/**
 * Run one agent turn to completion without a request lifecycle, mirroring /api/chat: the
 * stream is drained here, the reply is stored in the thread, and the job ends completed,
 * failed, or parked waiting for approval/takeover.
 */
async function executeTurn(input: TurnInput): Promise<TurnOutcome> {
  const { userId, locale, store, bot, thread, job, messages, requestMessage, assistantId, runMode } = input;
  const tr = translatorFor(locale);
  const author = { id: bot.id, name: bot.name, accent: bot.accent };
  const streamHistory = [...messages.filter((message) => message.id !== requestMessage.id), requestMessage];
  let failure: unknown;
  let response: UIMessage | undefined;
  let aborted = false;
  let failureHandled = false;

  const fail = async (error: unknown) => {
    if (failureHandled) return;
    failureHandled = true;
    const message = translateError(locale, error);
    await setComputer(userId, { status: "idle", workingLabel: "", workingBotId: null, lastError: message, jobId: job.id }).catch(() => undefined);
    const failed = await finishJob(userId, job.id, "failed", { error: message }).catch(() => null);
    if (failed) {
      await createNotification({
        userId,
        jobId: job.id,
        kind: "failed",
        title: tr("{name} could not finish the task", { name: bot.name }),
        body: message,
      }).catch(() => undefined);
    }
  };

  try {
    const { model, providerOptions, tokenMultiplier } = await getDeniModel(userId, runMode);
    const group = thread.kind === "group";
    const tools = createDeniTools({ userId, bot, threadId: thread.id, jobId: job.id, allowHandoff: !group, locale });
    const result = streamText({
      model,
      instructions:
        buildInstructions(
          bot,
          store.skills,
          store.bots.map((item) => ({ id: item.id, name: item.name, job: item.job })),
        ) + (group ? groupNote(bot.name) : ""),
      messages: await convertToModelMessages(compactMessagesForModel(messagesWithReplyContext(group ? groupContext(messages, bot.id) : messages))),
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
        void Promise.allSettled([
          heartbeatJob(userId, job.id),
          checkpointJob(userId, job.id, checkpoint),
          recordTokenUsage(userId, step.usage, { multiplier: tokenMultiplier }),
        ]).then((results) => {
          for (const item of results) if (item.status === "rejected") console.error("persist discord step", item.reason);
        });
      },
      onError: (event) => {
        failure = event.error;
        reportError(event, "discord chat");
      },
    });

    const stream = toUIMessageStream({
      stream: result.stream,
      originalMessages: streamHistory,
      generateMessageId: () => assistantId,
      messageMetadata: () => ({ author, jobId: job.id }),
      onEnd: ({ messages: next, isAborted }) => {
        response = next.find((message) => message.id === assistantId);
        aborted = isAborted;
      },
    });
    const reader = stream.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    if (failure) throw failure;

    if (response) {
      const stored = { ...response, metadata: { ...((response.metadata as object) ?? {}), author, jobId: job.id } } as UIMessage;
      response = stored;
      await saveMessages(userId, thread.id, [stored]);
    }
    if (aborted) {
      await finishJob(userId, job.id, "cancelled");
      return { kind: "notice", text: tr("The task was cancelled.") };
    }
    if (response && hasPendingWorkflowWait(response)) {
      if (pendingApprovalParts(response).length) {
        // deniToolApproval moves the job in the background; make sure it is parked before replying.
        await transitionJob(userId, job.id, "running", { status: "waiting_approval" });
        return approvalOutcome(response, job.id, bot, locale);
      }
      return {
        kind: "takeover",
        botName: bot.name,
        text: tr("{name} needs your help on the computer. Open the app, finish the step, then send a message here.", { name: bot.name }),
      };
    }

    await setComputer(userId, { status: "idle", workingLabel: "", workingBotId: null, jobId: job.id }).catch(() => undefined);
    const text = finalText(response) || tr("Task completed.");
    const completed = await finishJob(userId, job.id, "completed", { result: { status: "completed" } });
    if (completed) {
      await createNotification({
        userId,
        jobId: job.id,
        kind: "completed",
        title: tr("{name} finished a task", { name: bot.name }),
        body: text.slice(0, 240),
      }).catch(() => undefined);
    }
    return { kind: "reply", botName: bot.name, text };
  } catch (error) {
    await fail(error);
    return { kind: "notice", text: discordErrorText(locale, error) || tr("The model call failed") };
  }
}

type Preflight = { ok: true; store: Store } | { ok: false; outcome: TurnOutcome };

/** Checks every turn shares: rate limit, an API key, and remaining tokens. */
async function preflight(userId: string, locale: string): Promise<Preflight> {
  const tr = translatorFor(locale);
  try {
    await assertRateLimit(userId, "discord-chat", 20);
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, outcome: { kind: "notice", text: tr("Too many requests. Wait a moment and try again.") } };
    throw error;
  }
  const store = await readStore(userId);
  if (!(await getApiKey(userId))) return { ok: false, outcome: { kind: "notice", text: tr("Add an OpenRouter API key in the app before using Discord.") } };
  try {
    await assertCanUseTokens(userId);
  } catch (error) {
    return { ok: false, outcome: { kind: "notice", text: discordErrorText(locale, error) } };
  }
  return { ok: true, store };
}

/** The latest approval request this job is waiting on, in a DM or a group thread. */
function pendingRequestFor(persisted: UIMessage[], jobId: string) {
  return persisted.findLast(
    (message) =>
      message.role === "assistant" &&
      pendingApprovalParts(message).length > 0 &&
      (message.metadata as { jobId?: unknown } | undefined)?.jobId === jobId,
  );
}

/**
 * One teammate's answer to one Discord message in a DM or group thread: continue a task parked
 * for takeover, re-show a pending approval, or start a new job and run it.
 */
async function runBotTurn(options: {
  userId: string;
  locale: string;
  store: Store;
  bot: Bot;
  thread: Thread;
  incoming: UIMessage;
  idempotencyKey: string;
}): Promise<TurnOutcome> {
  const { userId, locale, store, bot, thread, incoming, idempotencyKey } = options;
  const tr = translatorFor(locale);
  const active = (await listJobs(userId, { threadId: thread.id, limit: 20, summary: true })).find(
    (job) => job.botId === bot.id && job.kind === "chat" && ACTIVE.includes(job.status),
  );
  if (active?.status === "waiting_approval") {
    // Only a Discord-started job can be answered with these buttons; the web chat owns the rest.
    const full = await getJob(userId, active.id);
    const persisted = await loadMessages(userId, thread.id);
    const pending = pendingRequestFor(persisted, active.id);
    if (full?.payload.source !== "discord" || !pending) {
      return { kind: "notice", text: tr("A task is waiting for your approval in the app.") };
    }
    return approvalOutcome(pending, active.id, bot, locale);
  }
  if (active && active.status !== "waiting_takeover") {
    return { kind: "notice", text: tr("{name} is still working on your last message.", { name: bot.name }) };
  }

  if (await getJobByIdempotencyKey(userId, idempotencyKey)) return { kind: "none" };
  const messages = mergeThreadMessages(await loadMessages(userId, thread.id), [incoming]);
  const runMode = parseRunMode(store.config.runMode);
  const hash = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 12);

  // A task parked for takeover continues with the person's next message once they finished the step.
  if (active) {
    const claimed = await claimJob(userId, active.id, {
      from: "waiting_takeover",
      threadId: thread.id,
      botId: bot.id,
      key: idempotencyKey,
      payload: { messages, runMode, locale },
    });
    if (!claimed?.claimed || claimed.job.status !== "running") return { kind: "none" };
    try {
      await releaseBrowserTakeover(userId, active.id);
      await setComputer(userId, { status: "idle", workingLabel: "", workingBotId: null, jobId: active.id });
      await saveMessages(userId, thread.id, [incoming]);
    } catch (error) {
      await transitionJob(userId, active.id, "running", { status: "waiting_takeover", payload: claimed.job.payload, lockedAt: null, heartbeatAt: null });
      reportError(error, "resume discord takeover");
      return { kind: "notice", text: tr("Could not resume the task. Please send your message again.") };
    }
    return executeTurn({ userId, locale, store, bot, thread, job: claimed.job, messages, requestMessage: incoming, assistantId: `${active.id}_assistant_${hash}`, runMode });
  }

  const created = await createJob({
    userId,
    threadId: thread.id,
    botId: bot.id,
    kind: "chat",
    idempotencyKey,
    payload: { messages, runMode, locale, source: "discord" },
  });
  await saveMessages(userId, thread.id, [incoming]);
  const claimed = await claimJob(userId, created.id);
  if (!claimed?.claimed || claimed.job.status !== "running") return { kind: "none" };
  return executeTurn({ userId, locale, store, bot, thread, job: claimed.job, messages, requestMessage: incoming, assistantId: `${created.id}_assistant_${hash}`, runMode });
}

function incomingMessage(discordMessageId: string, text: string): UIMessage {
  return { id: `discord_${discordMessageId}`, role: "user", parts: [{ type: "text", text }] };
}

/** Handle a plain Discord message from a linked user, sent to the chosen teammate's DM thread. */
export async function runDiscordMessage(options: {
  userId: string;
  discordMessageId: string;
  text: string;
  botId: string | null;
  locale: string;
}): Promise<TurnOutcome> {
  const { userId, locale } = options;
  const tr = translatorFor(locale);
  const checked = await preflight(userId, locale);
  if (!checked.ok) return checked.outcome;
  const target = pickBot(checked.store, options.botId);
  if (!target) return { kind: "notice", text: tr("Create a teammate in the app first, then message again.") };
  return runBotTurn({
    userId,
    locale,
    store: checked.store,
    bot: target.bot,
    thread: target.thread,
    incoming: incomingMessage(options.discordMessageId, options.text),
    idempotencyKey: `discord:${options.discordMessageId}`,
  });
}

/**
 * A plain message while a group is chosen: @name or @everyone picks who answers, like the web
 * group chat, and each teammate answers in parallel with its own job.
 */
async function runDiscordGroupMessage(
  options: { userId: string; discordMessageId: string; text: string; locale: string },
  store: Store,
  group: NonNullable<ReturnType<typeof pickGroup>>,
): Promise<TurnOutcome[]> {
  const { userId, locale } = options;
  let recipients: Bot[];
  try {
    recipients = groupRecipients(options.text, group.members);
  } catch (error) {
    return [{ kind: "notice", text: discordErrorText(locale, error) }];
  }
  const incoming = incomingMessage(options.discordMessageId, options.text);
  const tr = translatorFor(locale);
  return Promise.all(
    recipients.map(async (bot) => {
      // One message can wake every member, so each turn is counted like a web chat turn.
      try {
        await assertRateLimit(userId, "chat", 40);
      } catch (error) {
        if (error instanceof RateLimitError) return { kind: "notice", text: `${bot.name}: ${tr("Too many requests. Wait a moment and try again.")}` } as TurnOutcome;
        throw error;
      }
      return runBotTurn({ userId, locale, store, bot, thread: group.thread, incoming, idempotencyKey: `discord:${options.discordMessageId}:${bot.id}` }).catch(
        (error): TurnOutcome => {
          reportError(error, "discord group turn");
          return { kind: "notice", text: `${bot.name}: ${discordErrorText(locale, error)}` };
        },
      );
    }),
  );
}

/** Route a plain Discord message to the chosen group, or else to the chosen teammate. */
export async function runDiscordConversation(options: {
  userId: string;
  discordMessageId: string;
  text: string;
  botId: string | null;
  locale: string;
}): Promise<{ group: string | null; outcomes: TurnOutcome[] }> {
  const group = pickGroup(await readStore(options.userId));
  if (!group) return { group: null, outcomes: [await runDiscordMessage(options)] };
  const checked = await preflight(options.userId, options.locale);
  if (!checked.ok) return { group: group.thread.title, outcomes: [checked.outcome] };
  const current = pickGroup(checked.store) ?? group;
  return { group: current.thread.title, outcomes: await runDiscordGroupMessage(options, checked.store, current) };
}

/** /reset: later turns in the current conversation start fresh. The history stays in the app. */
export async function resetDiscordConversation(options: { userId: string; botId: string | null; locale: string }) {
  const tr = translatorFor(options.locale);
  const store = await readStore(options.userId);
  const group = pickGroup(store);
  const teammate = group ? null : pickBot(store, options.botId);
  const target = group ? { name: group.thread.title, thread: group.thread } : teammate ? { name: teammate.bot.name, thread: teammate.thread } : null;
  if (!target) return tr("Create a teammate in the app first, then message again.");
  const result = await resetThreadContext(options.userId, target.thread.id);
  const name = { name: target.name };
  if (result === "missing") return tr("Create a teammate in the app first, then message again.");
  if (group) {
    if (result === "busy") return tr("A teammate in the group {name} is still working or waiting for you. Finish or stop that task, then reset.", name);
    if (result === "unchanged") return tr("The conversation in the group {name} is already fresh.", name);
    return tr("Started a new conversation in the group {name}. Earlier messages stay in the app but are no longer sent.", name);
  }
  if (result === "busy") return tr("{name} is still working or waiting for you. Finish or stop that task, then reset.", name);
  if (result === "unchanged") return tr("The conversation with {name} is already fresh.", name);
  return tr("Started a new conversation with {name}. Earlier messages stay in the app but are no longer sent.", name);
}

/** Apply an Approve/Deny button press to every request of that round and resume the job. */
export async function runDiscordApproval(options: {
  userId: string;
  jobId: string;
  round: string;
  approved: boolean;
  locale: string;
}): Promise<TurnOutcome> {
  const { userId, locale } = options;
  const tr = translatorFor(locale);
  const stale: TurnOutcome = { kind: "notice", text: tr("This approval is no longer pending.") };
  const job = await getJob(userId, options.jobId);
  if (!job || job.kind !== "chat" || job.status !== "waiting_approval" || job.payload.source !== "discord") return stale;
  const store = await readStore(userId);
  const bot = store.bots.find((item) => item.id === job.botId);
  const thread = store.threads.find((item) => item.id === job.threadId);
  if (!bot || !thread) return stale;
  const persisted = await loadMessages(userId, thread.id);
  // In a group several teammates can wait at once, so only this job's own request counts there.
  const target = pendingRequestFor(persisted, job.id)
    ?? (thread.kind === "dm" ? persisted.findLast((message) => message.role === "assistant" && pendingApprovalParts(message).length) : undefined);
  if (!target || approvalRound(target) !== options.round) return stale;

  const responded = {
    ...target,
    parts: (target.parts as unknown as ToolPart[]).map((part) =>
      isToolPart(part) && part.state === "approval-requested" && part.approval && !part.approval.isAutomatic
        ? {
            ...part,
            state: "approval-responded",
            approval: {
              ...part.approval,
              approved: options.approved,
              ...(options.approved ? {} : { reason: "Denied by the user in Discord" }),
            },
          }
        : part,
    ),
  } as UIMessage;
  const runMode = parseRunMode(typeof job.payload.runMode === "string" ? job.payload.runMode : store.config.runMode);
  const messages = mergeThreadMessages(persisted, [responded]);
  const claimed = await claimJob(userId, job.id, {
    from: "waiting_approval",
    threadId: thread.id,
    botId: bot.id,
    key: `discord-approval:${job.id}:${options.round}:${options.approved}`,
    payload: { messages, runMode, locale },
  });
  if (!claimed?.claimed || claimed.job.status !== "running") return stale;
  try {
    await saveMessages(userId, thread.id, [responded]);
  } catch (error) {
    await transitionJob(userId, job.id, "running", { status: "waiting_approval", payload: job.payload, lockedAt: null, heartbeatAt: null });
    reportError(error, "resume discord approval");
    return { kind: "notice", text: tr("Could not resume the task. Please send your message again.") };
  }
  return executeTurn({ userId, locale, store, bot, thread, job: claimed.job, messages, requestMessage: responded, assistantId: responded.id, runMode });
}

/** A short id for Discord component custom ids, which are limited to 100 characters. */
export function discordComponentId(action: "approve" | "deny", jobId: string, round: string) {
  return `dap:${action === "approve" ? "y" : "n"}:${jobId}:${round}`;
}

export function parseDiscordComponentId(value: string) {
  const [prefix, answer, jobId, round] = value.split(":");
  if (prefix !== "dap" || (answer !== "y" && answer !== "n") || !jobId || !round) return null;
  return { approved: answer === "y", jobId, round };
}
