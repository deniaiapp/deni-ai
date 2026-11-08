import type { UIMessage } from "ai";

const MAX_REASONING_MODEL = 2_000;
const MAX_TOOL_UI = 400;

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
  // The client only needs a glimpse of a large result; the model always gets it whole.
  const keep: Record<string, unknown> = {
    truncated: true,
    preview: truncateString(resultText(value), max),
  };
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

/** MCP results carry their text in content items; anything else is read as JSON. */
function resultText(value: object) {
  const content = (value as { content?: unknown }).content;
  if (Array.isArray(content)) {
    const texts = content.flatMap((item) =>
      item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
        ? [(item as { text: string }).text]
        : [],
    );
    if (texts.length > 0) return texts.join("\n");
  }
  return json(value);
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
  for (const key of [
    "action",
    "path",
    "url",
    "command",
    "name",
    "reason",
    "key",
    "selector",
    "connectionId",
  ]) {
    const value = rec[key];
    if (typeof value === "string") keep[key] = truncateString(value, 200);
    else if (value != null) keep[key] = value;
  }
  // MCP approval cards show where a call goes and the text it writes, also after a reload.
  if (rec.arguments && typeof rec.arguments === "object")
    keep.arguments = slimArguments(rec.arguments);
  return keep;
}

/**
 * Shortens each MCP argument on its own, so a long body never hides short ones such as the
 * recipient and subject, and the client never sees a placeholder in place of the arguments.
 */
function slimArguments(args: object): unknown {
  if (Array.isArray(args)) return slimJson(args, MAX_TOOL_UI);
  const keep: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args).slice(0, 20)) {
    if (typeof value === "string") keep[key] = truncateString(value, MAX_TOOL_UI);
    else if (value == null || typeof value !== "object") keep[key] = value;
    else {
      const text = json(value);
      // A large nested value is left out; the step and the approval card only summarize.
      if (text.length <= 200) keep[key] = value;
    }
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
  return {
    id,
    role: "system",
    parts: [],
    metadata: { kind: CONTEXT_RESET, at: new Date().toISOString() },
  };
}

/** How long the teammate worked on this reply, saved by the chat route so it survives a reload. */
export function workedMsOf(message: UIMessage | undefined): number | undefined {
  const value = (message?.metadata as { workedMs?: unknown } | undefined)?.workedMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function isContextReset(message: UIMessage) {
  return (
    message.role === "system" &&
    (message.metadata as { kind?: unknown } | undefined)?.kind === CONTEXT_RESET
  );
}

const COMPACTION = "compaction";

type CompactionMetadata = {
  kind: typeof COMPACTION;
  at: string;
  throughMessageId: string;
  summary: string;
};

/**
 * A divider stored in the thread once a long conversation is compacted. The model sees its
 * summary in place of every message up to and including throughMessageId.
 */
export function compactionMessage(
  id: string,
  throughMessageId: string,
  summary: string,
): UIMessage {
  const metadata: CompactionMetadata = {
    kind: COMPACTION,
    at: new Date().toISOString(),
    throughMessageId,
    summary,
  };
  return { id, role: "system", parts: [], metadata };
}

export function isCompaction(message: UIMessage) {
  return (
    message.role === "system" &&
    (message.metadata as { kind?: unknown } | undefined)?.kind === COMPACTION
  );
}

// The Run and Run+ models take 1M tokens. A conversation is compacted once the model's view of it
// passes the limit, keeping about the last COMPACT_KEEP_TOKENS of turns verbatim. The rest of the
// window is left for instructions and tool definitions, the tool results a turn adds before it can
// compact again, the reply, and the error in estimateTokens. Tool results are never shortened, so
// the model always sees what it based its answers on; the cut stays put between compactions, so
// the cached prompt prefix keeps being reused.
export const COMPACT_TOKEN_LIMIT = 700_000;
const COMPACT_KEEP_TOKENS = 100_000;
// If compaction fails, whole turns are trimmed from the front once the history passes the limit,
// down to the target.
export const HISTORY_TOKEN_LIMIT = 750_000;
export const HISTORY_TOKEN_TARGET = 500_000;
const TRIMMED_NOTE =
  "[Earlier messages in this conversation were left out to save tokens. Call conversationHistory for a summary of them or to search them.]";
const COMPACTED_NOTE =
  "[Earlier messages in this conversation were compacted into the summary below. Call conversationHistory to search or read them in full when you need a detail the summary leaves out.]";

/** Rough count: about four ASCII characters per token, and one token per other character. */
export function estimateTokens(text: string) {
  // oxlint-disable-next-line no-control-regex -- strips the ASCII range on purpose
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

function messageTokens(message: UIMessage) {
  let total = 4;
  for (const part of message.parts) {
    if (part.type === "text") total += estimateTokens(part.text);
    else if (part.type === "reasoning")
      total += estimateTokens(truncateString(part.text, MAX_REASONING_MODEL));
    else if (isToolPart(part)) {
      const tool = part as { input?: unknown; output?: unknown };
      total += estimateTokens(json(tool.input)) + estimateTokens(json(tool.output));
    } else total += estimateTokens(json(part).slice(0, 4_000));
  }
  return total;
}

/**
 * Where the model's view of a thread opens: after the latest reset, or after what the latest
 * compaction since then summarized. A compaction whose last message is gone is skipped.
 */
function windowStart(messages: UIMessage[]) {
  const reset = messages.findLastIndex(isContextReset);
  for (let index = messages.length - 1; index > reset; index--) {
    if (!isCompaction(messages[index])) continue;
    const { throughMessageId, summary } = messages[index].metadata as CompactionMetadata;
    const through = messages.findIndex((message) => message.id === throughMessageId);
    if (through > reset && typeof summary === "string") return { start: through + 1, summary };
  }
  return { start: reset + 1, summary: undefined };
}

function visiblePositions(messages: UIMessage[], start: number) {
  const positions: number[] = [];
  for (let index = start; index < messages.length; index++) {
    if (messages[index].role !== "system") positions.push(index);
  }
  return positions;
}

/**
 * What the model sees of a thread: the latest compaction's summary and everything after it,
 * trimmed to a token budget if compaction could not keep up. Turns are only dropped whole, from
 * the front, so the window always opens on a user message and always keeps the newest one. Each
 * cut depends only on the messages before it, so it stays put as the conversation grows.
 */
function contextWindow(messages: UIMessage[]) {
  const { start: from, summary } = windowStart(messages);
  const positions = visiblePositions(messages, from);
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
  return { positions: positions.slice(start), trimmed: start > 0, summary };
}

/**
 * The messages to summarize once the model's view passes COMPACT_TOKEN_LIMIT: from the start of
 * the view up to the last whole turn that leaves about COMPACT_KEEP_TOKENS of recent turns as
 * they are. The latest user message and everything after it are always kept.
 */
export function compactionPlan(messages: UIMessage[]) {
  const { start, summary } = windowStart(messages);
  const positions = visiblePositions(messages, start);
  const weights = positions.map((position) => messageTokens(messages[position]));
  const total = weights.reduce(
    (sum, weight) => sum + weight,
    summary ? estimateTokens(summary) : 0,
  );
  if (total <= COMPACT_TOKEN_LIMIT) return undefined;
  let keepFrom: number | undefined;
  let tail = 0;
  for (let index = positions.length - 1; index >= 0; index--) {
    tail += weights[index];
    if (messages[positions[index]].role !== "user") continue;
    if (keepFrom !== undefined && tail > COMPACT_KEEP_TOKENS) break;
    keepFrom = index;
  }
  if (!keepFrom) return undefined;
  return {
    previousSummary: summary,
    messages: positions.slice(0, keepFrom).map((position) => messages[position]),
    throughMessageId: messages[positions[keepFrom - 1]].id,
  };
}

/** Index of the first message the model sees; everything before it is reachable only through conversationHistory. */
export function modelContextStart(messages: UIMessage[]) {
  return contextWindow(messages).positions[0] ?? messages.length;
}

export function modelContextMessages(messages: UIMessage[]): UIMessage[] {
  const { positions, trimmed, summary } = contextWindow(messages);
  const scoped = positions.map((position) => messages[position]);
  const notes = [
    trimmed ? TRIMMED_NOTE : "",
    summary ? `${COMPACTED_NOTE}\n\n${summary}` : "",
  ].filter(Boolean);
  if (!notes.length || !scoped.length) return scoped;
  const [first, ...rest] = scoped;
  return [
    {
      ...first,
      parts: [...notes.map((text) => ({ type: "text" as const, text })), ...first.parts],
    },
    ...rest,
  ];
}

/** Drops reasoning; OpenRouter also reads its signatures from tool call metadata. */
function withoutReasoning(message: UIMessage): UIMessage {
  const parts = message.parts.flatMap((part) => {
    if (part.type === "reasoning") return [];
    const metadata = (part as { callProviderMetadata?: { openrouter?: Record<string, unknown> } })
      .callProviderMetadata;
    if (!isToolPart(part) || !metadata?.openrouter || !("reasoning_details" in metadata.openrouter))
      return [part];
    const { reasoning_details: _, ...openrouter } = metadata.openrouter;
    return [
      { ...part, callProviderMetadata: { ...metadata, openrouter } } as UIMessage["parts"][number],
    ];
  });
  return { ...message, parts };
}

/**
 * Anthropic binds each signed thinking block to the exact conversation before it. A final
 * assistant message (a tool loop resumed after an approval) keeps every step's thinking, so its
 * prefix matches what the model saw; earlier turns go without. A block whose prefix still moved
 * is dropped by Anthropic (block_binding drop_block in agent/llm.ts) instead of failing the request.
 */
function reasoningForModel(messages: UIMessage[]): UIMessage[] {
  return messages.map((message, index) =>
    index === messages.length - 1 && message.role === "assistant"
      ? message
      : withoutReasoning(message),
  );
}

/**
 * The thread as the model sees it: its context window with stale reasoning dropped. Tool results
 * stay whole, as the model saw them when it answered; compaction keeps the total in check.
 */
export function messagesForModel(thread: UIMessage[]): UIMessage[] {
  return reasoningForModel(modelContextMessages(thread));
}

export function mergeThreadMessages(persisted: UIMessage[], incoming: UIMessage[]): UIMessage[] {
  const messages = normalizeMessageIds(persisted);
  const byId = new Map(messages.map((item, index) => [item.id, index]));
  for (const item of incoming) {
    const index = item.id ? byId.get(item.id) : findLegacyEcho(messages, item);
    if (index !== undefined)
      messages[index] = restoreToolParts(messages[index], { ...item, id: messages[index].id });
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
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

function withMessageId(message: UIMessage, index: number): UIMessage {
  if (message.id) return message;
  const value = JSON.stringify([message.role, message.parts]);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
  return {
    ...message,
    id: `legacy-message:${index}:${(hash >>> 0).toString(16)}`,
    metadata: { ...metadata, legacyActionKey: `legacy:${index}` },
  };
}

function findLegacyEcho(messages: UIMessage[], message: UIMessage): number | undefined {
  if (message.id) return undefined;
  const text = plainText(message);
  for (let index = messages.length - 1; index >= 0; index--) {
    const existing = messages[index];
    if (
      existing.role === message.role &&
      plainText(existing) === text &&
      existing.id.startsWith("legacy-message:")
    )
      return index;
  }
  return undefined;
}

export function normalizeMessageIds(messages: UIMessage[]): UIMessage[] {
  const normalized = messages.map(withMessageId);
  // Older chat completion code stored a second, text-only job answer before the
  // actual streamed message. Remove only a matching duplicate in the same turn.
  const filtered = normalized.filter((message, index) => {
    if (
      message.role !== "assistant" ||
      (message.metadata as { author?: unknown } | undefined)?.author ||
      !/^job_[a-z0-9]+_assistant$/.test(message.id)
    )
      return true;
    const text = plainText(message);
    if (!text) return true;
    let start = index;
    while (start > 0 && normalized[start - 1].role !== "user") start--;
    let end = index + 1;
    while (end < normalized.length && normalized[end].role !== "user") end++;
    return !normalized.slice(start, end).some(
      (other) =>
        other.id !== message.id &&
        other.role === "assistant" &&
        other.parts
          .filter((part) => part.type === "text")
          .at(-1)
          ?.text.trim() === text,
    );
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
    const next =
      legacyIndex !== undefined
        ? { ...value, id: messages[legacyIndex].id, metadata: messages[legacyIndex].metadata }
        : withMessageId(value, messages.length);
    const index = positions.get(next.id);
    if (index === undefined) {
      positions.set(next.id, messages.length);
      messages.push(next);
    } else messages[index] = next;
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
      const previous =
        typeof rec.toolCallId === "string" ? byCallId.get(rec.toolCallId) : undefined;
      if (!previous) return part;
      const next: Record<string, unknown> = { ...rec };
      if ("input" in previous) next.input = previous.input;
      if ("rawInput" in previous) next.rawInput = previous.rawInput;
      if ("output" in previous) next.output = previous.output;
      return next as UIMessage["parts"][number];
    }),
  };
}
