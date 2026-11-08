import { Check, ShieldAlert, Wrench, X } from "lucide-react";
import type { UIMessage } from "ai";
import { useExtracted } from "use-intl";
import { Badge } from "@deniai/ui/components/badge";
import { Button } from "@deniai/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@deniai/ui/components/card";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { TeammateAvatar } from "./teammate-avatar";

const BUBBLE_BREAK = "<!-- split -->";

type ToolPart = {
  type: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  approval?: { id: string; approved?: boolean; reason?: string };
};

export type MessageAuthor = { id: string; name: string; accent?: string; icon?: string | null };

function isToolPart(part: { type: string }): part is ToolPart {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function toolName(part: ToolPart) {
  return part.toolName ?? part.type.replace(/^tool-/, "");
}

function inputPreview(input: unknown) {
  if (input === undefined || input === null) return null;
  try {
    const text = typeof input === "string" ? input : JSON.stringify(input, null, 2);
    return text.length > 600 ? `${text.slice(0, 600)}…` : text;
  } catch {
    return null;
  }
}

/** A gated action waiting for the person: what the teammate wants to do, Approve / Deny. */
export function ApprovalCard({
  part,
  onRespond,
  disabled,
}: {
  part: ToolPart;
  onRespond?: (approvalId: string, approved: boolean) => void;
  disabled?: boolean;
}) {
  const t = useExtracted();
  const preview = inputPreview(part.input);
  const answered = part.state === "approval-responded" || part.state === "output-denied";
  return (
    <Card size="sm" className="border-primary/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-primary" />
          {t("Approval needed")}
        </CardTitle>
        <CardDescription>
          {t("The teammate wants to run {tool}.", { tool: toolName(part) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {preview ? (
          <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
            {preview}
          </pre>
        ) : null}
        {answered ? (
          <Badge variant={part.approval?.approved ? "secondary" : "outline"}>
            {part.approval?.approved ? t("Approved") : t("Denied")}
          </Badge>
        ) : (
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={disabled || !part.approval?.id || !onRespond}
              onClick={() => part.approval && onRespond?.(part.approval.id, true)}
            >
              <Check className="size-4" />
              {t("Approve")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || !part.approval?.id || !onRespond}
              onClick={() => part.approval && onRespond?.(part.approval.id, false)}
            >
              <X className="size-4" />
              {t("Deny")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ToolChip({ part }: { part: ToolPart }) {
  const t = useExtracted();
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";
  return (
    <div className="flex w-fit items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
      <Wrench className="size-3" />
      <span className="font-mono">{toolName(part)}</span>
      {running ? <Shimmer>{t("working")}</Shimmer> : null}
      {failed ? <span className="text-destructive">{t("failed")}</span> : null}
      {part.state === "output-denied" ? <span>{t("denied")}</span> : null}
    </div>
  );
}

/** One Run message: the author (groups), text bubbles, tool activity and approval cards. */
export function RunMessage({
  message,
  author,
  showAuthor,
  onApprovalResponse,
  approvalsDisabled,
  streaming,
}: {
  message: UIMessage;
  author?: MessageAuthor | null;
  showAuthor?: boolean;
  onApprovalResponse?: (approvalId: string, approved: boolean) => void;
  approvalsDisabled?: boolean;
  streaming?: boolean;
}) {
  const t = useExtracted();
  const parts = message.parts;
  const hasContent = parts.some(
    (part) => (part.type === "text" && part.text.trim()) || isToolPart(part),
  );
  return (
    <Message from={message.role}>
      {showAuthor && author && message.role === "assistant" ? (
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <TeammateAvatar name={author.name} icon={author.icon} accent={author.accent} size="sm" />
          {author.name}
        </div>
      ) : null}
      <MessageContent>
        {!hasContent && streaming ? <Shimmer>{t("Thinking…")}</Shimmer> : null}
        {parts.map((part, index) => {
          if (part.type === "text") {
            const bubbles = part.text
              .split(BUBBLE_BREAK)
              .map((bubble) => bubble.trim())
              .filter(Boolean);
            return bubbles.map((bubble, bubbleIndex) =>
              message.role === "user" ? (
                <p
                  key={`${index}-${bubbleIndex}`}
                  className="whitespace-pre-wrap [overflow-wrap:anywhere]"
                >
                  {bubble}
                </p>
              ) : (
                <MessageResponse key={`${index}-${bubbleIndex}`}>{bubble}</MessageResponse>
              ),
            );
          }
          if (part.type === "file") {
            return (
              <span key={index} className="text-xs text-muted-foreground">
                {part.filename ?? t("Attachment")}
              </span>
            );
          }
          if (isToolPart(part)) {
            if (
              part.approval &&
              (part.state === "approval-requested" || part.state === "approval-responded")
            )
              return (
                <ApprovalCard
                  key={part.toolCallId ?? index}
                  part={part}
                  onRespond={onApprovalResponse}
                  disabled={approvalsDisabled}
                />
              );
            return <ToolChip key={part.toolCallId ?? index} part={part} />;
          }
          return null;
        })}
      </MessageContent>
    </Message>
  );
}

export function messageAuthorOf(message: UIMessage): MessageAuthor | null {
  const author = (message.metadata as { author?: MessageAuthor } | undefined)?.author;
  return author && typeof author.id === "string" ? author : null;
}
