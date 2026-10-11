import type { UIMessage } from "ai";

export const CHAT_INITIAL_MESSAGE_COUNT = 5;
export const CHAT_OLDER_MESSAGE_COUNT = 20;

export type ChatMessageWindow = {
  messages: UIMessage[];
  oldestIndex: number;
  hasMore: boolean;
  total: number;
};

export function sliceLatestMessages(
  messages: UIMessage[],
  count = CHAT_INITIAL_MESSAGE_COUNT,
): ChatMessageWindow {
  const total = messages.length;
  const oldestIndex = Math.max(0, total - count);
  return {
    messages: messages.slice(oldestIndex),
    oldestIndex,
    hasMore: oldestIndex > 0,
    total,
  };
}

export function sliceOlderMessages(
  messages: UIMessage[],
  beforeIndex: number,
  limit = CHAT_OLDER_MESSAGE_COUNT,
): ChatMessageWindow {
  const total = messages.length;
  const end = Math.max(0, Math.min(beforeIndex, total));
  const start = Math.max(0, end - Math.max(1, limit));
  return {
    messages: messages.slice(start, end),
    oldestIndex: start,
    hasMore: start > 0,
    total,
  };
}

export function mergeMessageWindow(older: UIMessage[], current: UIMessage[]): UIMessage[] {
  if (older.length === 0) {
    return current;
  }
  if (current.length === 0) {
    return older;
  }

  const currentIds = new Set(current.map((message) => message.id));
  const uniqueOlder = older.filter((message) => !currentIds.has(message.id));
  return [...uniqueOlder, ...current];
}

/**
 * Combine a stored transcript with the client window (which may include a
 * brand-new user message or a regenerated tail that is not in the DB yet).
 */
export function mergeStoredAndClientMessages(
  stored: UIMessage[],
  client: UIMessage[],
): UIMessage[] {
  if (stored.length === 0) {
    return client;
  }
  if (client.length === 0) {
    return stored;
  }

  const firstClientId = client[0]?.id;
  if (firstClientId) {
    const overlap = stored.findIndex((message) => message.id === firstClientId);
    if (overlap >= 0) {
      return [...stored.slice(0, overlap), ...client];
    }
  }

  const lastStoredId = stored.at(-1)?.id;
  if (lastStoredId) {
    const index = client.findIndex((message) => message.id === lastStoredId);
    if (index >= 0) {
      return [...stored.slice(0, -1), ...client.slice(index)];
    }
  }

  const storedIds = new Set(stored.map((message) => message.id));
  const newTail = client.filter((message) => !storedIds.has(message.id));
  if (newTail.length > 0 && newTail.length <= 4) {
    return [...stored, ...newTail];
  }

  return client.length >= stored.length ? client : stored;
}

/**
 * The assistant message a request continues in place. After a questionnaire
 * answer the client resends that message last, and the answer belongs to it.
 * A regenerate always starts a new message.
 */
export function getContinuedAssistantMessage(
  messages: UIMessage[],
  trigger: string | undefined,
): UIMessage | undefined {
  const last = messages.at(-1);
  return trigger !== "regenerate-message" && last?.role === "assistant" && last.id
    ? last
    : undefined;
}

function getBranchGroupId(message: UIMessage): string | undefined {
  const groupId = (message.metadata as { branchGroupId?: unknown } | undefined)?.branchGroupId;
  return typeof groupId === "string" && groupId ? groupId : undefined;
}

function getToolCallIds(message: UIMessage): string[] {
  return message.parts.flatMap((part) =>
    "toolCallId" in part && typeof part.toolCallId === "string" ? [part.toolCallId] : [],
  );
}

/**
 * The transcript the model sees. Regenerated alternatives stay stored for the
 * branch picker, but only the last one (the branch shown by default) is sent,
 * and a regenerate also drops the alternatives of the answer it replaces so
 * the prompt ends with the user turn. Older questionnaire continuations were
 * saved as a second assistant message repeating the first one's tool calls,
 * so the first copy is skipped to keep tool call IDs unique.
 */
export function selectModelContextMessages(
  messages: UIMessage[],
  { regenerate = false }: { regenerate?: boolean } = {},
): UIMessage[] {
  const selected = messages.filter((message, index) => {
    const next = messages[index + 1];
    if (message.role !== "assistant" || next?.role !== "assistant") return true;
    const groupId = getBranchGroupId(message);
    if (groupId && getBranchGroupId(next) === groupId) return false;
    const toolCallIds = getToolCallIds(message);
    const nextToolCallIds = new Set(getToolCallIds(next));
    return !(toolCallIds.length > 0 && toolCallIds.every((id) => nextToolCallIds.has(id)));
  });
  while (regenerate) {
    const last = selected.at(-1);
    if (last?.role !== "assistant" || !getBranchGroupId(last)) break;
    selected.pop();
  }
  return selected;
}

export function mergeServerWindow(current: UIMessage[], serverWindow: UIMessage[]): UIMessage[] {
  if (current.length === 0) {
    return serverWindow;
  }
  if (serverWindow.length === 0) {
    return current;
  }

  const serverIds = new Set(serverWindow.map((message) => message.id));
  const firstServerId = serverWindow[0]?.id;
  const overlap = firstServerId ? current.findIndex((message) => message.id === firstServerId) : -1;

  if (overlap >= 0) {
    const tail = current.filter((message, index) => index >= overlap && !serverIds.has(message.id));
    return [...current.slice(0, overlap), ...serverWindow, ...tail];
  }

  return mergeMessageWindow(current, serverWindow);
}
