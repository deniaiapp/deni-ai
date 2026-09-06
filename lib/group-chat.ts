import type { UIMessage } from "ai";
import type { Bot } from "./types";

export type MessageAuthor = Pick<Bot, "id" | "name" | "accent">;
export function messageRequestKey(message: UIMessage): string {
  if (message.role !== "assistant") return message.id;
  const approvals = message.parts.flatMap((part) => {
    const value = part as { approval?: { id?: string; approved?: boolean } };
    return value.approval?.id && typeof value.approval.approved === "boolean" ? [[value.approval.id, value.approval.approved]] : [];
  });
  const value = JSON.stringify(approvals);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `${message.id}:approval:${(hash >>> 0).toString(16)}`;
}
export function messageAuthor(message: UIMessage): MessageAuthor | null {
  const value = (message.metadata as { author?: unknown } | undefined)?.author;
  if (!value || typeof value !== "object") return null;
  const author = value as Partial<MessageAuthor>;
  return typeof author.id === "string" && typeof author.name === "string" && typeof author.accent === "string" ? author as MessageAuthor : null;
}

function escaped(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function mentioned(text: string, name: string) {
  return new RegExp(`(^|[\\s(,])@${escaped(name)}(?=$|[\\s.,!?;:()。、！？])`, "iu").test(text);
}

export function groupRecipients(text: string, members: Bot[]): Bot[] {
  const prose = text.replace(/```[\s\S]*?```|`[^`]*`/g, "");
  if (mentioned(prose, "everyone")) return members;
  const selected = members.filter((bot) => mentioned(prose, bot.name) || mentioned(prose, bot.id));
  if (selected.length) return selected;
  if (/(^|[\s(,])@[^\s]+/u.test(prose)) throw new Error("No teammate matched that mention. Choose a name or use @everyone.");
  return members;
}

export function groupContext(messages: UIMessage[], botId: string): UIMessage[] {
  return messages.map((message) => {
    const author = messageAuthor(message);
    if (message.role !== "assistant" || !author || author.id === botId) return message;
    const text = message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n\n");
    return { ...message, role: "user", parts: [{ type: "text", text: `[${author.name}, another teammate]\n${text || "Used a tool."}` }] } as UIMessage;
  });
}
