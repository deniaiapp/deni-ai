import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Bot as BotIcon,
  CheckIcon,
  AlertCircleIcon as CircleAlertIcon,
  PaperclipIcon,
  XIcon,
} from "lucide-react";
import type { UIMessage } from "ai";
import { useExtracted } from "use-intl";
import { isCompaction, isContextReset, workedMsOf } from "@deniai/run/chat/messages";
import { splitBubbleBreaks, usesBubbleBreaks } from "@deniai/run/chat/message-bubbles";
import { Alert, AlertDescription, AlertTitle } from "@deniai/ui/components/alert";
import { Button } from "@deniai/ui/components/button";
import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import { TeammateAvatar } from "./teammate-avatar";

type ToolPart = {
  type: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean; reason?: string; isAutomatic?: boolean };
};

export type MessageAuthor = { id: string; name: string; accent?: string; icon?: string | null };

function isToolPart(part: { type: string }): part is ToolPart {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function toolName(part: ToolPart) {
  return part.toolName ?? part.type.replace(/^tool-/, "").replace(/^dynamic-/, "");
}

function inputValue(input: unknown, key: string) {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function snippet(value?: string, max = 72) {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function humanizeToolName(name: string) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase();
}

/** What a tool step is called while it waits or runs, and when it failed. */
function useToolLabels() {
  const t = useExtracted();
  return (name: string): [present: string, failed: string] => {
    if (name === "browser" || name.toLowerCase().includes("browser"))
      return [t("Using the browser"), t("Couldn't use the browser")];
    const labels: Record<string, [string, string]> = {
      workspace: [t("Updating files"), t("Couldn't update files")],
      runCommand: [t("Running a command"), t("Couldn't run a command")],
      stopSandbox: [t("Stopping the computer"), t("Couldn't stop the computer")],
      webSearch: [t("Searching the web"), t("Couldn't search the web")],
      remember: [t("Saving a memory"), t("Couldn't save a memory")],
      saveSkill: [t("Saving a skill"), t("Couldn't save a skill")],
      scheduleRoutine: [t("Scheduling a routine"), t("Couldn't schedule a routine")],
      pauseRoutine: [t("Updating a routine"), t("Couldn't update a routine")],
      builtInPlugin: [t("Using a connected service"), t("Couldn't use a connected service")],
      mcp: [t("Using a connected app"), t("Couldn't use a connected app")],
      messageBot: [t("Asking a teammate"), t("Couldn't ask a teammate")],
      requestTakeover: [t("Waiting for your help"), t("Couldn't request your help")],
    };
    const tool = humanizeToolName(name);
    return (
      labels[name] ?? [t("Working on {tool}", { tool }), t("Couldn't finish {tool}", { tool })]
    );
  };
}

/** The detail line under an approval: the command, file or service action it is about. */
function approvalDetail(name: string, input: unknown) {
  if (name === "runCommand") return snippet(inputValue(input, "command"));
  if (name === "workspace") return snippet(inputValue(input, "path"));
  if (name === "mcp") return snippet(inputValue(input, "name"));
  if (name === "builtInPlugin")
    return snippet(
      [
        inputValue(input, "kind"),
        inputValue(input, "action"),
        inputValue(input, "repo"),
        inputValue(input, "to"),
        inputValue(input, "subject"),
        inputValue(input, "title"),
      ]
        .filter(Boolean)
        .join(" · "),
      220,
    );
  return undefined;
}

/** True once the element's content is taller than one line of its text. */
function useMultiline() {
  const ref = useRef<HTMLDivElement>(null);
  const [multiline, setMultiline] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 20;
    // contentRect excludes padding, so changing the padding never flips the result by itself.
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setMultiline(entry.contentRect.height > lineHeight * 1.5);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, multiline] as const;
}

/** One chat bubble: the person's on the right, the teammate's on the left. */
function Bubble({ role, children }: { role: UIMessage["role"]; children: ReactNode }) {
  const [ref, multiline] = useMultiline();
  return (
    <div
      className={cn(
        "flex max-w-full min-w-0 flex-col text-sm",
        role === "user"
          ? "w-max rounded-3xl bg-foreground/20 text-foreground wrap-anywhere [&_pre]:overflow-x-auto"
          : "w-fit rounded-2xl bg-muted text-foreground",
      )}
    >
      <div ref={ref} className={cn("min-w-0", multiline ? "px-4.5 py-3.5" : "px-3.5 py-2.5")}>
        {children}
      </div>
    </div>
  );
}

/** A gated action waiting for the person: what the teammate wants to do, Approve / Deny. */
function ApprovalCard({
  part,
  onRespond,
  disabled,
}: {
  part: ToolPart;
  onRespond?: (approvalId: string, approved: boolean) => void;
  disabled?: boolean;
}) {
  const t = useExtracted();
  const labels = useToolLabels();
  const [answering, setAnswering] = useState<"approve" | "deny" | null>(null);
  const name = toolName(part);
  const requested = part.state === "approval-requested";
  const detail = approvalDetail(name, part.input);
  const body = name === "builtInPlugin" ? inputValue(part.input, "body") : undefined;
  const approval = part.approval;
  if (!approval) return null;
  return (
    <Alert
      className={cn(
        "flex flex-col gap-2",
        requested && "border-amber-500/40 bg-amber-500/5 dark:border-amber-400/30",
      )}
    >
      <AlertDescription className="inline text-foreground">{labels(name)[0]}</AlertDescription>
      {detail ? <p className="font-mono text-xs text-muted-foreground">{detail}</p> : null}
      {body ? (
        <pre className="max-h-40 overflow-auto rounded-lg bg-foreground/5 p-2 text-xs whitespace-pre-wrap">
          {body}
        </pre>
      ) : null}
      {requested ? (
        <div className="flex items-center justify-end gap-2 self-end">
          <Button
            size="xs"
            type="button"
            disabled={disabled || answering !== null || !onRespond}
            onClick={() => {
              setAnswering("approve");
              onRespond?.(approval.id, true);
            }}
          >
            {t("Approve")}
          </Button>
          <Button
            size="xs"
            type="button"
            variant="outline"
            disabled={disabled || answering !== null || !onRespond}
            onClick={() => {
              setAnswering("deny");
              onRespond?.(approval.id, false);
            }}
          >
            {t("Deny")}
          </Button>
        </div>
      ) : approval.approved === true ? (
        <p className="flex items-center gap-1.5 self-end text-xs text-muted-foreground">
          <CheckIcon className="size-3.5" aria-hidden="true" />
          {t("Approved")}
        </p>
      ) : approval.approved === false ? (
        <p className="flex items-center gap-1.5 self-end text-xs text-muted-foreground">
          <XIcon className="size-3.5" aria-hidden="true" />
          {t("Declined")}
        </p>
      ) : null}
      {part.state === "output-error" && part.errorText ? (
        <p className="text-xs text-destructive">{part.errorText}</p>
      ) : null}
    </Alert>
  );
}

/** A failed tool step. Other steps stay hidden: the teammate's own lines say what it is doing. */
function FailedStep({ label }: { label: string }) {
  return (
    <div className="flex min-w-0 gap-2 px-1 py-0.5 text-xs text-muted-foreground">
      <CircleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span className="break-words">{label}</span>
    </div>
  );
}

function ToolPartView({
  part,
  onApprovalResponse,
  approvalsDisabled,
}: {
  part: ToolPart;
  onApprovalResponse?: (approvalId: string, approved: boolean) => void;
  approvalsDisabled?: boolean;
}) {
  const t = useExtracted();
  const labels = useToolLabels();
  const name = toolName(part);
  if (part.approval && !part.approval.isAutomatic) {
    // Still being written, and not yet asked: nothing to show.
    if (
      part.approval.approved === undefined &&
      (part.state === "input-streaming" || part.state === "input-available")
    )
      return null;
    return <ApprovalCard part={part} onRespond={onApprovalResponse} disabled={approvalsDisabled} />;
  }
  if (name === "requestTakeover") {
    const failed = part.state === "output-error";
    const reason = inputValue(part.input, "reason");
    return (
      <Alert variant={failed ? "destructive" : "default"}>
        <CircleAlertIcon />
        <AlertTitle>
          {failed ? t("Couldn't request your help") : t("Requested your help")}
        </AlertTitle>
        <AlertDescription>
          {failed
            ? part.errorText || t("The computer could not be handed over.")
            : `${reason ? `${reason} ` : ""}${t("Take control of the computer to continue.")}`}
        </AlertDescription>
      </Alert>
    );
  }
  if (part.state === "output-error" && name !== "messageBot" && name !== "handoffStatus")
    return <FailedStep label={labels(name)[1]} />;
  return null;
}

function useWorkedLabel() {
  const t = useExtracted();
  return (ms: number) => {
    const seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 60) return t("Worked for {count}s", { count: String(seconds) });
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return t("Worked for {count}m", { count: String(minutes) });
    return t("Worked for {count}h", { count: String(Math.round(minutes / 60)) });
  };
}

function messageFiles(message: UIMessage) {
  const value = (message.metadata as { attachments?: unknown } | undefined)?.attachments;
  const fromMetadata = Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        const file = item as { path?: unknown; name?: unknown } | null;
        if (!file || typeof file.path !== "string") return [];
        return [{ key: file.path, name: typeof file.name === "string" ? file.name : file.path }];
      })
    : [];
  const fromParts = message.parts.flatMap((part, index) =>
    part.type === "file" ? [{ key: `part-${index}`, name: part.filename ?? "" }] : [],
  );
  return [...fromMetadata, ...fromParts];
}

/** One Run message: the author (groups), chat bubbles, approvals and failed steps. */
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
  const workedLabel = useWorkedLabel();
  if (isContextReset(message))
    return <Divider>{t("New conversation · earlier messages are not sent")}</Divider>;
  if (isCompaction(message))
    return <Divider>{t("Earlier messages were summarized to save tokens")}</Divider>;
  if (message.role === "system") return null;

  const user = message.role === "user";
  const breaks = !user && usesBubbleBreaks(message.metadata);
  const files = messageFiles(message);
  const hasTools = message.parts.some(isToolPart);
  const workedMs = workedMsOf(message);

  return (
    <div
      className={cn(
        "group flex w-full min-w-0 animate-fade-in-up",
        user ? "justify-end" : "flex-col items-stretch gap-2",
      )}
    >
      {showAuthor && !user ? (
        <div className="mb-1 flex items-center gap-2">
          <TeammateAvatar
            name={author?.name ?? t("Teammate")}
            icon={author?.icon}
            accent={author?.accent}
            size="sm"
          />
          <span className="text-xs font-semibold text-muted-foreground">
            {author?.name ?? t("Teammate")}
          </span>
        </div>
      ) : null}
      <div
        className={cn(
          "flex flex-col gap-1",
          user ? "max-w-[min(640px,90%)] items-end" : "w-full max-w-[min(640px,92%)] min-w-0",
        )}
      >
        {files.length ? (
          <div className={cn("flex flex-wrap gap-1.5", user && "justify-end")}>
            {files.map((file) => (
              <span
                key={file.key}
                className="inline-flex max-w-60 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs text-muted-foreground"
              >
                <PaperclipIcon className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{file.name || t("Attachment")}</span>
              </span>
            ))}
          </div>
        ) : null}
        {message.parts.map((part, index) => {
          if (part.type === "text") {
            const bubbles = breaks ? splitBubbleBreaks(part.text) : [part.text.trim()];
            return bubbles.filter(Boolean).map((bubble, bubbleIndex) => (
              <Bubble key={`${index}-${bubbleIndex}`} role={message.role}>
                {user ? (
                  <p className="whitespace-pre-wrap">{bubble}</p>
                ) : (
                  <MessageResponse isAnimating={streaming}>{bubble}</MessageResponse>
                )}
              </Bubble>
            ));
          }
          if (isToolPart(part))
            return (
              <Fragment key={part.toolCallId ?? index}>
                <ToolPartView
                  part={part}
                  onApprovalResponse={onApprovalResponse}
                  approvalsDisabled={approvalsDisabled}
                />
              </Fragment>
            );
          return null;
        })}
        {!user && hasTools && !streaming && workedMs != null ? (
          <span className="px-1 text-xs text-muted-foreground">{workedLabel(workedMs)}</span>
        ) : null}
      </div>
    </div>
  );
}

function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Three dots in a reply bubble while the teammate is still working. */
export function TypingIndicator() {
  const t = useExtracted();
  return (
    <div
      role="status"
      aria-label={t("Working")}
      className="flex w-fit animate-fade-in-up items-center gap-1 rounded-2xl bg-muted px-3.5 py-3"
    >
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 rounded-full bg-foreground/60 motion-safe:animate-pulse"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

/** The empty conversation: who the teammate is and how to talk to it. */
export function TeammateEmptyState({ name, job }: { name: string; job?: string }) {
  const t = useExtracted();
  return (
    <div className="flex flex-1 animate-fade-in-up flex-col items-center justify-center gap-3 p-8 text-center">
      <BotIcon className="size-12 text-muted-foreground" aria-hidden="true" />
      <div className="max-w-md space-y-1">
        <h3 className="text-sm font-medium">{name}</h3>
        <p className="text-sm text-muted-foreground">
          {job
            ? t(
                "{job}. No workflow is required. Write as if you were asking a colleague. I will research on the computer, leave artifacts in files, and ask for approval only when needed.",
                { job },
              )
            : t(
                "No workflow is required. Write as if you were asking a colleague. I will research on the computer, leave artifacts in files, and ask for approval only when needed.",
              )}
        </p>
      </div>
    </div>
  );
}

export function messageAuthorOf(message: UIMessage): MessageAuthor | null {
  const author = (message.metadata as { author?: MessageAuthor } | undefined)?.author;
  return author && typeof author.id === "string" ? author : null;
}
