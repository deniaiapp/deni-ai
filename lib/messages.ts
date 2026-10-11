import type { UIMessage } from "ai";

const RECENT_COUNT = 10;
const MAX_REASONING_MODEL = 2_000;
const MAX_TOOL_UI = 400;
const MAX_TOOL_MODEL_RECENT = 6_000;
const MAX_TOOL_MODEL_OLD = 1_500;

function isToolPart(part: { type: string }) {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function truncateString(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…`;
}

function slimJson(value: unknown, max: number): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return truncateString(value, max);
  if (typeof value !== "object") return value;
  const rec = value as Record<string, unknown>;
  const next: Record<string, unknown> = { ...rec };
  if ("snapshot" in next) delete next.snapshot;
  if (typeof next.stdout === "string") next.stdout = truncateString(next.stdout, max);
  if (typeof next.stderr === "string")
    next.stderr = truncateString(next.stderr, Math.min(max, 1_500));
  if (typeof next.content === "string") next.content = truncateString(next.content, max);
  if (typeof next.body === "string") next.body = truncateString(next.body, max);
  try {
    if (JSON.stringify(next).length <= max) return next;
  } catch {
    return { truncated: true };
  }
  const keep: Record<string, unknown> = { truncated: true };
  for (const key of ["url", "title", "path", "error", "ok", "exitCode", "name", "action"]) {
    if (key in rec) keep[key] = rec[key];
  }
  if (Array.isArray(rec.results)) {
    keep.results = rec.results.slice(0, 10).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      if (typeof entry.url !== "string") return [];
      return [
        {
          url: truncateString(entry.url, 300),
          ...(typeof entry.title === "string" ? { title: truncateString(entry.title, 120) } : {}),
        },
      ];
    });
  }
  return keep;
}

function mapMessageParts(
  messages: UIMessage[],
  mapPart: (part: UIMessage["parts"][number], messageIndex: number) => UIMessage["parts"][number],
): UIMessage[] {
  return messages.map((message, messageIndex) => ({
    ...message,
    parts: message.parts.map((part) => mapPart(part, messageIndex)),
  }));
}

function slimToolInput(input: unknown) {
  if (!input || typeof input !== "object") return input;
  const rec = input as Record<string, unknown>;
  const keep: Record<string, unknown> = {};
  for (const key of ["action", "path", "url", "command", "name", "reason", "key", "selector"]) {
    const value = rec[key];
    if (typeof value === "string") keep[key] = truncateString(value, 200);
    else if (value != null) keep[key] = value;
  }
  return keep;
}

export function slimMessagesForClient(messages: UIMessage[]): UIMessage[] {
  return mapMessageParts(messages, (part) => {
    if (isToolPart(part)) {
      const tool = part as { output?: unknown; input?: unknown; rawInput?: unknown };
      return {
        ...part,
        input: slimToolInput(tool.input ?? tool.rawInput),
        rawInput: undefined,
        output: slimJson(tool.output, MAX_TOOL_UI),
      } as UIMessage["parts"][number];
    }
    return part;
  });
}

const CONTEXT_RESET = "context-reset";

/**
 * A divider stored in the thread. The conversation above it stays visible to the person, but
 * the model only ever sees what comes after the latest one.
 */
export function contextResetMessage(id: string): UIMessage {
  return { id, role: "system", parts: [], metadata: { kind: CONTEXT_RESET, at: new Date().toISOString() } };
}

export function isContextReset(message: UIMessage) {
  return message.role === "system" && (message.metadata as { kind?: unknown } | undefined)?.kind === CONTEXT_RESET;
}

// History is trimmed once it passes the limit, down to the target. The gap between the two
// keeps the cut in place for many turns, so the cached prompt prefix keeps being reused.
// Instructions, tool definitions, and recent tool output come on top, so a request stays
// around 200k tokens.
export const HISTORY_TOKEN_LIMIT = 180_000;
export const HISTORY_TOKEN_TARGET = 100_000;
const TRIMMED_NOTE = "[Earlier messages in this conversation were left out to save tokens. Call conversationHistory for a summary of them or to search them.]";

/** Rough count: about four ASCII characters per token, and one token per other character. */
function estimateTokens(text: string) {
  const other = text.replace(/[\x00-\x7f]/g, "").length;
  return Math.ceil((text.length - other) / 4) + other;
}

function json(value: unknown) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

// Measured as if every message were old, so a message weighs the same on every turn and the
// cut point does not drift as it ages out of the recent window.
function messageTokens(message: UIMessage) {
  let total = 4;
  for (const part of message.parts) {
    if (part.type === "text") total += estimateTokens(part.text);
    else if (part.type === "reasoning") total += estimateTokens(truncateString(part.text, MAX_REASONING_MODEL));
    else if (isToolPart(part)) {
      const tool = part as { input?: unknown; output?: unknown };
      total += estimateTokens(json(tool.input)) + estimateTokens(json(slimJson(tool.output, MAX_TOOL_MODEL_OLD)));
    } else total += estimateTokens(json(part).slice(0, 4_000));
  }
  return total;
}

/**
 * What the model sees of a thread: everything after the latest reset, trimmed to a token
 * budget. Turns are only dropped whole, from the front, so the window always opens on a user
 * message and always keeps the newest one. Each cut depends only on the messages before it,
 * so it stays put as the conversation grows.
 */
function contextWindow(messages: UIMessage[]) {
  const positions: number[] = [];
  for (let index = messages.findLastIndex(isContextReset) + 1; index < messages.length; index++) {
    if (messages[index].role !== "system") positions.push(index);
  }
  const weights = positions.map((position) => messageTokens(messages[position]));
  let start = 0;
  let total = 0;
  for (let index = 0; index < positions.length; index++) {
    total += weights[index];
    if (total <= HISTORY_TOKEN_LIMIT) continue;
    let rest = total;
    for (let cut = start + 1; cut <= index; cut++) {
      rest -= weights[cut - 1];
      if (messages[positions[cut]].role !== "user") continue;
      start = cut;
      total = rest;
      if (rest <= HISTORY_TOKEN_TARGET) break;
    }
  }
  return { positions: positions.slice(start), trimmed: start > 0 };
}

/** Index of the first message the model sees; everything before it is reachable only through conversationHistory. */
export function modelContextStart(messages: UIMessage[]) {
  return contextWindow(messages).positions[0] ?? messages.length;
}

export function modelContextMessages(messages: UIMessage[]): UIMessage[] {
  const { positions, trimmed } = contextWindow(messages);
  const scoped = positions.map((position) => messages[position]);
  if (!trimmed) return scoped;
  const [first, ...rest] = scoped;
  return [{ ...first, parts: [{ type: "text", text: TRIMMED_NOTE }, ...first.parts] }, ...rest];
}

/** Slim tool output and reasoning for the model, after cutting the thread to its context window. */
export function compactMessagesForModel(thread: UIMessage[]): UIMessage[] {
  const messages = modelContextMessages(thread);
  const startRecent = Math.max(0, messages.length - RECENT_COUNT);
  return mapMessageParts(messages, (part, messageIndex) => {
    const recent = messageIndex >= startRecent;
    if (part.type === "reasoning" && "text" in part && typeof part.text === "string") {
      if (recent && messageIndex === messages.length - 1) return part;
      return { ...part, text: truncateString(part.text, MAX_REASONING_MODEL) };
    }
    if (isToolPart(part) && "output" in part) {
      return {
        ...part,
        output: slimJson(
          (part as { output?: unknown }).output,
          recent ? MAX_TOOL_MODEL_RECENT : MAX_TOOL_MODEL_OLD,
        ),
      } as UIMessage["parts"][number];
    }
    return part;
  });
}

export function mergeThreadMessages(persisted: UIMessage[], incoming: UIMessage[]): UIMessage[] {
  const messages = normalizeMessageIds(persisted);
  const byId = new Map(messages.map((item, index) => [item.id, index]));
  for (const item of incoming) {
    const index = item.id ? byId.get(item.id) : findLegacyEcho(messages, item);
    if (index !== undefined) messages[index] = restoreToolParts(messages[index], { ...item, id: messages[index].id });
    // Clients may append user input, but cannot invent new assistant messages.
    else if (item.role === "user") {
      const next = withMessageId(item, messages.length);
      byId.set(next.id, messages.length);
      messages.push(next);
    }
  }
  return messages;
}

function plainText(message: UIMessage) {
  return message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n\n").trim();
}

function withMessageId(message: UIMessage, index: number): UIMessage {
  if (message.id) return message;
  const value = JSON.stringify([message.role, message.parts]);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
  return { ...message, id: `legacy-message:${index}:${(hash >>> 0).toString(16)}`, metadata: { ...metadata, legacyActionKey: `legacy:${index}` } };
}

function findLegacyEcho(messages: UIMessage[], message: UIMessage): number | undefined {
  if (message.id) return undefined;
  const text = plainText(message);
  for (let index = messages.length - 1; index >= 0; index--) {
    const existing = messages[index];
    if (existing.role === message.role && plainText(existing) === text && existing.id.startsWith("legacy-message:")) return index;
  }
  return undefined;
}

export function normalizeMessageIds(messages: UIMessage[]): UIMessage[] {
  const normalized = messages.map(withMessageId);
  // Older chat completion code stored a second, text-only job answer before the
  // actual streamed message. Remove only a matching duplicate in the same turn.
  const filtered = normalized.filter((message, index) => {
    if (message.role !== "assistant" || (message.metadata as { author?: unknown } | undefined)?.author || !/^job_[a-z0-9]+_assistant$/.test(message.id)) return true;
    const text = plainText(message);
    if (!text) return true;
    let start = index;
    while (start > 0 && normalized[start - 1].role !== "user") start--;
    let end = index + 1;
    while (end < normalized.length && normalized[end].role !== "user") end++;
    return !normalized.slice(start, end).some((other) => other.id !== message.id && other.role === "assistant" && other.parts.filter((part) => part.type === "text").at(-1)?.text.trim() === text);
  });
  const unique = new Map<string, UIMessage>();
  for (const message of filtered) unique.set(message.id, message);
  return [...unique.values()];
}

/** Server/live-stream upsert. Existing positions stay stable while new replies append. */
export function mergeStoredMessages(persisted: UIMessage[], incoming: UIMessage[]): UIMessage[] {
  const messages = normalizeMessageIds(persisted);
  const positions = new Map(messages.map((message, index) => [message.id, index]));
  for (const value of incoming) {
    const legacyIndex = findLegacyEcho(messages, value);
    const next = legacyIndex !== undefined ? { ...value, id: messages[legacyIndex].id, metadata: messages[legacyIndex].metadata } : withMessageId(value, messages.length);
    const index = positions.get(next.id);
    if (index === undefined) { positions.set(next.id, messages.length); messages.push(next); }
    else messages[index] = next;
  }
  return normalizeMessageIds(messages);
}

// The client only ever holds slimmed tool parts (see slimMessagesForClient), so when it echoes a
// message back we keep its state and approval but take input/output from the persisted copy.
function restoreToolParts(persisted: UIMessage, incoming: UIMessage): UIMessage {
  const byCallId = new Map<string, Record<string, unknown>>();
  for (const part of persisted.parts) {
    if (!isToolPart(part)) continue;
    const rec = part as Record<string, unknown>;
    if (typeof rec.toolCallId === "string") byCallId.set(rec.toolCallId, rec);
  }
  if (byCallId.size === 0) return incoming;
  return {
    ...incoming,
    parts: incoming.parts.map((part) => {
      if (!isToolPart(part)) return part;
      const rec = part as Record<string, unknown>;
      const previous = typeof rec.toolCallId === "string" ? byCallId.get(rec.toolCallId) : undefined;
      if (!previous) return part;
      const next: Record<string, unknown> = { ...rec };
      if ("input" in previous) next.input = previous.input;
      if ("rawInput" in previous) next.rawInput = previous.rawInput;
      if ("output" in previous) next.output = previous.output;
      return next as UIMessage["parts"][number];
    }),
  };
}
