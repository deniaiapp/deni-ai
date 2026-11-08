import { Chat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { mergeStoredMessages } from "./messages";
import { messageAuthor, messageRequestKey, type MessageAuthor } from "./group-chat";
import { USAGE_LIMIT_HEADER, UsageLimitError, isUsageMetric } from "../billing/plans";

export type GroupReplyStatus = { author: MessageAuthor; status: string; jobId?: string; messageId?: string; error?: string };
const EMPTY_GROUP_STATUS: Record<string, GroupReplyStatus> = {};

type SessionConfig = {
  threadId: string;
  botId: string;
  runMode: string;
  jobId?: string;
};

type ChatSession = {
  chat: Chat<UIMessage>;
  config: SessionConfig;
  lastUsedAt: number;
  hasPendingJob: boolean;
  runStatus: ChatRunStatus;
  statusListeners: Set<() => void>;
  groupStatuses: Record<string, GroupReplyStatus>;
  groupListeners: Set<() => void>;
  approvalQueue: Promise<void>;
};

export type ChatRunStatus = "idle" | "working" | "finalizing" | "waiting" | "completed" | "failed";

const MAX_SESSIONS = 100;
const sessions = new Map<string, ChatSession>();

function publishRunStatus(threadId: string, status: ChatRunStatus) {
  const session = sessions.get(threadId);
  if (!session || session.runStatus === status) return;
  session.runStatus = status;
  session.statusListeners.forEach((listener) => listener());
}

export function setChatSessionRunStatus(threadId: string, status: ChatRunStatus) {
  publishRunStatus(threadId, status);
}

export function getChatSessionRunStatus(threadId: string): ChatRunStatus {
  return sessions.get(threadId)?.runStatus ?? "idle";
}

export function subscribeChatSessionRunStatus(threadId: string, listener: () => void) {
  const session = sessions.get(threadId);
  if (!session) return () => undefined;
  session.statusListeners.add(listener);
  return () => session.statusListeners.delete(listener);
}

export function getGroupReplyStatuses(threadId: string) { return sessions.get(threadId)?.groupStatuses ?? EMPTY_GROUP_STATUS; }
export function subscribeGroupReplyStatuses(threadId: string, listener: () => void) {
  const session = sessions.get(threadId);
  if (!session) return () => {};
  session.groupListeners.add(listener);
  return () => { session.groupListeners.delete(listener); };
}

export function approveGroupTool(threadId: string, id: string, approved: boolean): Promise<void> {
  const session = sessions.get(threadId);
  if (!session) return Promise.reject(new Error("Conversation is not available."));
  const task = session.approvalQueue.then(async () => {
    const chat = session.chat;
    if (chat.status === "streaming" || chat.status === "submitted") await new Promise<void>((resolve) => {
      const unsubscribe = chat["~registerStatusCallback"](() => { if (chat.status !== "streaming" && chat.status !== "submitted") { unsubscribe(); resolve(); } });
    });
    const source = chat.messages.find((message) => message.parts.some((part) => (part as { approval?: { id?: string } }).approval?.id === id));
    if (!source) throw new Error("The approval message is no longer available.");
    const updated: UIMessage = { ...source, parts: source.parts.map((part) => {
      const value = part as { approval?: { id?: string; approved?: boolean } };
      return value.approval?.id === id ? { ...part, state: "approval-responded", approval: { ...value.approval, approved } } as UIMessage["parts"][number] : part;
    }) };
    chat.messages = mergeStoredMessages(chat.messages, [updated]);
    publishRunStatus(threadId, "working");
    await chat.sendMessage(undefined, { body: { approvalMessage: updated } });
  });
  session.approvalQueue = task.catch(() => undefined);
  return task;
}

function active(config: SessionConfig, jobId?: string) {
  config.jobId = jobId || undefined;
}

function evictIdleSessions() {
  if (sessions.size <= MAX_SESSIONS) return;
  const idle = [...sessions.values()]
    .filter(
      (entry) =>
        !entry.hasPendingJob &&
        entry.chat.status !== "streaming" &&
        entry.chat.status !== "submitted",
    )
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  while (sessions.size > MAX_SESSIONS && idle.length > 0) {
    const entry = idle.shift();
    if (!entry) break;
    sessions.delete(entry.config.threadId);
  }
}

/**
 * Keep the AI SDK Chat object alive independently of the rendered thread. A component can
 * unmount during navigation while this object continues to consume its stream and notify a
 * later subscriber through useChat({ chat }).
 */
export function getChatSession(options: {
  threadId: string;
  botId: string;
  runMode: string;
  jobId?: string;
  hasPendingJob?: boolean;
  initialMessages: UIMessage[];
  kind?: "dm" | "group";
}) {
  const current = sessions.get(options.threadId);
  if (current) {
    current.config.botId = options.botId;
    current.config.runMode = options.runMode;
    // A polling snapshot may lag behind the live stream's waiting job ID.
    if (options.jobId || !["working", "waiting", "finalizing"].includes(current.runStatus)) active(current.config, options.jobId);
    current.hasPendingJob = options.hasPendingJob ?? current.hasPendingJob;
    current.lastUsedAt = Date.now();
    evictIdleSessions();
    return current.chat;
  }

  const config: SessionConfig = {
    threadId: options.threadId,
    botId: options.botId,
    runMode: options.runMode,
    jobId: options.jobId,
  };
  const transport = new DefaultChatTransport<UIMessage>({
    api: options.kind === "group" ? "/api/group-chat" : "/api/chat",
    // Keep which usage limit stopped the message so the thread can offer a way past it.
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      const metric = response.headers.get(USAGE_LIMIT_HEADER);
      if (response.status === 402 && isUsageMetric(metric)) {
        throw new UsageLimitError(metric, await response.text());
      }
      return response;
    },
    body: () => ({
      threadId: config.threadId,
      botId: config.botId,
      runMode: config.runMode,
      ...(config.jobId ? { jobId: config.jobId } : {}),
    }),
    prepareSendMessagesRequest: ({ messages, body, trigger }) => {
      const approvalMessage = body?.approvalMessage as UIMessage | undefined;
      const outgoing = approvalMessage ?? messages.at(-1);
      return { body: {
        ...body,
        trigger,
        messages: outgoing ? [outgoing] : [],
        idempotencyKey: outgoing ? messageRequestKey(outgoing) : undefined,
        ...(config.jobId ? { jobId: config.jobId } : {}),
      } };
    },
  });
  const chat = new Chat<UIMessage>({
    id: options.threadId,
    messages: options.initialMessages,
    transport,
    onData: (part) => {
      const current = sessions.get(options.threadId);
      if (options.kind === "group" && current) {
        const data = part.data as Record<string, unknown> | undefined;
        if (part.type === "data-group-message") {
          const message = data?.message as UIMessage | undefined;
          const author = message && messageAuthor(message);
          if (message?.id && message.role === "assistant" && Array.isArray(message.parts) && author) {
            if (current.groupStatuses[author.id]?.messageId !== message.id) {
              current.groupStatuses = { ...current.groupStatuses, [author.id]: { ...current.groupStatuses[author.id], status: current.groupStatuses[author.id]?.status ?? "working", author, messageId: message.id } };
              current.groupListeners.forEach((listener) => listener());
            }
            current.chat.messages = mergeStoredMessages(current.chat.messages, [message]);
          }
          return;
        }
        if (part.type === "data-group-targets" && Array.isArray(data?.authors)) {
          current.groupStatuses = Object.fromEntries((data.authors as MessageAuthor[]).map((author) => [author.id, { author, status: "working" }]));
          current.groupListeners.forEach((listener) => listener());
          publishRunStatus(options.threadId, "working");
          return;
        }
        if (part.type === "data-group-status") {
          const author = data?.author as MessageAuthor | undefined;
          if (author?.id && typeof data?.status === "string") {
            current.groupStatuses = { ...current.groupStatuses, [author.id]: { ...current.groupStatuses[author.id], author, status: data.status, ...(typeof data.jobId === "string" ? { jobId: data.jobId } : {}), ...(typeof data.error === "string" ? { error: data.error } : {}) } };
            current.groupListeners.forEach((listener) => listener());
          }
          return;
        }
        if (part.type === "data-group-finished" && ["waiting", "completed", "failed"].includes(String(data?.status))) {
          publishRunStatus(options.threadId, data?.status as ChatRunStatus);
          return;
        }
      }
      if (part.type !== "data-job-status") return;
      const value = part.data;
      if (!value || typeof value !== "object") return;
      const status = (value as Record<string, unknown>).status;
      if (
        status === "working" ||
        status === "finalizing" ||
        status === "waiting" ||
        status === "completed" ||
        status === "failed"
      ) {
        const jobId = (value as Record<string, unknown>).jobId;
        if (status === "completed" || status === "failed") config.jobId = undefined;
        else if (typeof jobId === "string") config.jobId = jobId;
        publishRunStatus(options.threadId, status);
      }
    },
    sendAutomaticallyWhen: options.kind === "group" ? undefined : lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  sessions.set(options.threadId, {
    chat,
    config,
    lastUsedAt: Date.now(),
    hasPendingJob: options.hasPendingJob ?? false,
    runStatus: options.hasPendingJob ? "working" : "idle",
    statusListeners: new Set(),
    groupStatuses: {},
    groupListeners: new Set(),
    approvalQueue: Promise.resolve(),
  });
  evictIdleSessions();
  return chat;
}

export function updateChatSessionJobState(threadId: string, hasPendingJob: boolean) {
  const session = sessions.get(threadId);
  if (session) {
    session.hasPendingJob = hasPendingJob;
    session.lastUsedAt = Date.now();
  }
}

export function syncChatSessionMessages(threadId: string, messages: UIMessage[]) {
  const session = sessions.get(threadId);
  if (!session || session.hasPendingJob || session.chat.status === "streaming" || session.chat.status === "submitted") {
    return false;
  }
  session.chat.messages = messages;
  return true;
}

export function clearChatSessionsForTests() {
  for (const entry of sessions.values()) void entry.chat.stop();
  sessions.clear();
}

export function discardChatSession(threadId: string) {
  const session = sessions.get(threadId);
  if (session) void session.chat.stop();
  sessions.delete(threadId);
}
