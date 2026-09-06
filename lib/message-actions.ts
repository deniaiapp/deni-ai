import type { UIMessage } from "ai";
import emojiRegex from "emoji-regex";
import { splitAssistantBubbles } from "./message-bubbles";

export type MessageReaction = string;

export function isMessageReaction(value: string): boolean {
  if (!value || value.length > 64) return false;
  return value.match(emojiRegex())?.[0] === value;
}

export type MessageReference = { key: string; role: "user" | "assistant"; text: string };
export type MessageBubble = MessageReference & { partIndex: number };

/** Shared by rendering and server validation so actions identify exactly one bubble. */
export function messageBubbleTargets(message: UIMessage, index: number): MessageBubble[] {
  if (message.role !== "user" && message.role !== "assistant") return [];
  const role = message.role;
  const baseKey = messageActionKey(message, index);
  const targets: MessageBubble[] = [];
  message.parts.forEach((part, partIndex) => {
    if (part.type !== "text" || !part.text.trim()) return;
    const texts = role === "assistant" ? splitAssistantBubbles(part.text) : [part.text];
    texts.forEach((text, bubbleIndex) => {
      // Existing whole-message reactions remain on the first bubble.
      const key = targets.length === 0 ? baseKey : `bubble:${JSON.stringify([baseKey, partIndex, bubbleIndex])}`;
      targets.push({ key, role, text, partIndex });
    });
  });
  return targets;
}

export function messageReference(message: UIMessage, index: number): MessageReference {
  return { key: messageActionKey(message, index), role: message.role === "user" ? "user" : "assistant", text: messageBody(message).slice(0, 4000) };
}

export function replyReference(message: UIMessage): MessageReference | null {
  const metadata = message.metadata as { replyTo?: unknown } | undefined;
  const value = metadata?.replyTo;
  if (!value || typeof value !== "object") return null;
  const ref = value as Partial<MessageReference>;
  return typeof ref.key === "string" && typeof ref.text === "string" && (ref.role === "user" || ref.role === "assistant")
    ? { key: ref.key, text: ref.text, role: ref.role } : null;
}

// Resolve client references against this account's stored conversation. Never
// trust a client-supplied excerpt as the contents of the referenced message.
export function resolveReplyReferences(incoming: UIMessage[], persisted: UIMessage[]): UIMessage[] {
  return incoming.map((message) => {
    if (message.role !== "user") return message;
    const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata as Record<string, unknown> : {};
    if (!metadata.replyTo) return message;
    const saved = message.id ? persisted.find((item) => item.id === message.id) : undefined;
    const savedReference = saved && replyReference(saved);
    if (savedReference) return { ...message, metadata: { ...metadata, replyTo: savedReference } };
    const key = (metadata.replyTo as Partial<MessageReference>).key;
    const target = persisted.flatMap(messageBubbleTargets).find((bubble) => bubble.key === key);
    if (!target) throw new Error("Reply target not found");
    return { ...message, metadata: { ...metadata, replyTo: { key: target.key, role: target.role, text: target.text.slice(0, 4000) } } };
  });
}

// Keep the visible user message untouched; supply the reference as context only
// when converting the persisted conversation into model input.
export function messagesWithReplyContext(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    const ref = replyReference(message);
    if (message.role !== "user" || !ref) return message;
    return { ...message, parts: [{ type: "text" as const, text: `Referenced ${ref.role} message (conversation context):\n${ref.text}` }, ...message.parts] };
  });
}

// Older saved conversations can contain empty SDK message IDs. Namespace their
// position separately from real IDs so those messages can still be reacted to.
export function messageActionKey(message: UIMessage, index: number): string {
  const legacyKey = (message.metadata as { legacyActionKey?: unknown } | undefined)?.legacyActionKey;
  if (message.id?.startsWith("legacy-message:") && typeof legacyKey === "string") return legacyKey;
  return message.id ? `id:${message.id}` : `legacy:${index}`;
}

export function messageBody(message: UIMessage): string {
  return message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n\n").trim();
}

export function updateReactions(current: string[], emoji: MessageReaction, selected: boolean): string[] {
  const next = new Set(current.filter(isMessageReaction));
  if (selected && isMessageReaction(emoji)) next.add(emoji);
  else next.delete(emoji);
  return [...next];
}
