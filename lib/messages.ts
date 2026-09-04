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

export function compactMessagesForModel(messages: UIMessage[]): UIMessage[] {
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
  if (incoming.length === 0) return persisted;
  if (incoming.length >= persisted.length) return incoming;
  const byId = new Map(persisted.map((item) => [item.id, item]));
  const extra: UIMessage[] = [];
  for (const item of incoming) {
    if (item.id && byId.has(item.id)) {
      byId.set(item.id, item);
    } else {
      extra.push(item);
    }
  }
  return [...byId.values(), ...extra];
}
