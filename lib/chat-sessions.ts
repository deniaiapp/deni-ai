import { Chat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";

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
    api: "/api/chat",
    body: () => ({
      threadId: config.threadId,
      botId: config.botId,
      runMode: config.runMode,
      ...(config.jobId ? { jobId: config.jobId } : {}),
    }),
    prepareSendMessagesRequest: ({ messages, body, trigger }) => ({
      body: {
        ...body,
        trigger,
        messages: trigger === "submit-message" ? messages.slice(-2) : [],
        idempotencyKey: messages.at(-1)?.id,
        ...(config.jobId ? { jobId: config.jobId } : {}),
      },
    }),
  });
  const chat = new Chat<UIMessage>({
    id: options.threadId,
    messages: options.initialMessages,
    transport,
    onData: (part) => {
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
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  sessions.set(options.threadId, {
    chat,
    config,
    lastUsedAt: Date.now(),
    hasPendingJob: options.hasPendingJob ?? false,
    runStatus: options.hasPendingJob ? "working" : "idle",
    statusListeners: new Set(),
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
