import type { UIMessage } from "ai";

/** True when a streamed turn ended because a human still needs to act. */
export function hasPendingWorkflowWait(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasPendingWorkflowWait);
  const record = value as Record<string, unknown>;
  const approval = record.approval;
  const approvalIsAutomatic =
    approval &&
    typeof approval === "object" &&
    (approval as Record<string, unknown>).isAutomatic === true;
  if (
    record.type === "tool-approval-request" &&
    record.isAutomatic !== true &&
    !approvalIsAutomatic
  ) {
    return true;
  }
  if (record.state === "approval-requested") return !approvalIsAutomatic;
  const toolCall = record.toolCall;
  const name =
    record.toolName ??
    (typeof record.type === "string" && record.type.startsWith("tool-")
      ? record.type.slice("tool-".length)
      : undefined) ??
    (toolCall && typeof toolCall === "object"
      ? (toolCall as Record<string, unknown>).toolName
      : undefined);
  const output = record.output;
  if (
    name === "requestTakeover" &&
    output &&
    typeof output === "object" &&
    (output as Record<string, unknown>).waiting === true
  ) {
    return true;
  }
  return (
    hasPendingWorkflowWait(record.content) ||
    hasPendingWorkflowWait(record.steps) ||
    hasPendingWorkflowWait(record.parts)
  );
}

export function lastAssistantText(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => ("text" in part ? String(part.text ?? "") : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  return undefined;
}

/**
 * Whether a job parked in waiting_approval still has a card the person can answer. A card
 * without a job ID also counts, so an older message never lets a live wait be cancelled.
 */
export function hasOpenApproval(messages: UIMessage[], jobId: string) {
  return messages.some((message) => {
    const owner = (message.metadata as { jobId?: unknown } | undefined)?.jobId;
    return message.role === "assistant" && (owner === undefined || owner === jobId) && message.parts.some((part) => {
      const value = part as { state?: string; approval?: { id?: string } };
      return value.state === "approval-requested" && Boolean(value.approval?.id);
    });
  });
}
