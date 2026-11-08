import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DefaultChatTransport,
  generateId,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { AtSign, Eraser, PanelRight, Send, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useExtracted } from "use-intl";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@deniai/ui/components/alert";
import { Button } from "@deniai/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@deniai/ui/components/sheet";
import { Textarea } from "@deniai/ui/components/textarea";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { DocumentTitle } from "@/components/document-title";
import { Link, useRouter } from "@/lib/navigation";
import {
  runFetch,
  runKeys,
  threadTeammates,
  useInvalidateRun,
  useRunState,
  useRunThread,
  useThreadJobs,
  type Bot,
  type RunState,
  type Thread,
} from "./run-api";
import { useRunErrorText } from "./run-error-text";
import { messageAuthorOf, RunMessage, type MessageAuthor } from "./run-message";
import { RunLoading, RunPage, takePendingTask } from "./run-page";
import { RunWorkspacePanel, useJobStatusLabel } from "./run-workspace-panel";
import { TeammateAvatar } from "./teammate-avatar";

/** The error the Run chat endpoints answered with: a code and, when present, detail text. */
export function parseChatError(error: Error | undefined) {
  if (!error) return null;
  try {
    const body = JSON.parse(error.message) as { code?: string; error?: string; metric?: string };
    return {
      code: body.code ?? body.error ?? "error",
      message: body.error ?? null,
      metric: body.metric,
    };
  } catch {
    return { code: "text", message: error.message, metric: undefined };
  }
}

function ChatErrorAlert({ error, onDismiss }: { error: Error; onDismiss: () => void }) {
  const t = useExtracted();
  const parsed = parseChatError(error);
  let title = t("The teammate could not answer");
  let description = parsed?.message ?? t("Something went wrong. Please try again.");
  let action: React.ReactNode = null;
  if (parsed?.code === "llm_unconfigured") {
    title = t("No AI model is configured");
    description = t(
      "Teammates cannot answer until an OpenRouter key is configured for Run on this server.",
    );
  } else if (parsed?.code === "usage_limit") {
    title = t("Usage limit reached");
    description = t("This month's usage is used up. Upgrade your plan to keep going.");
    action = (
      <Button size="sm" render={<Link href="/settings/billing" />} nativeButton={false}>
        {t("See plans")}
      </Button>
    );
  } else if (parsed?.code === "rate_limited") {
    description = t("Too many requests. Please wait a moment.");
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      <AlertAction className="flex gap-2">
        {action}
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {t("Dismiss")}
        </Button>
      </AlertAction>
    </Alert>
  );
}

function Composer({
  placeholder,
  disabled,
  busy,
  onSend,
  onStop,
  mentions,
}: {
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  onSend: (text: string) => void;
  onStop?: () => void;
  mentions?: Bot[];
}) {
  const t = useExtracted();
  const [text, setText] = useState("");
  const send = () => {
    const value = text.trim();
    if (!value || disabled || busy) return;
    onSend(value);
    setText("");
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-background p-2">
      {mentions?.length ? (
        <div className="flex flex-wrap gap-1">
          {[{ id: "everyone", name: "everyone" }, ...mentions].map((bot) => (
            <Button
              key={bot.id}
              type="button"
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() =>
                setText(
                  (current) =>
                    `${current}${current && !current.endsWith(" ") ? " " : ""}@${bot.name} `,
                )
              }
            >
              <AtSign className="size-3" />
              {bot.id === "everyone" ? t("everyone") : bot.name}
            </Button>
          ))}
        </div>
      ) : null}
      <Textarea
        value={text}
        rows={2}
        placeholder={placeholder}
        className="resize-none border-0 shadow-none focus-visible:ring-0"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="flex justify-end gap-2">
        {busy && onStop ? (
          <Button size="sm" variant="outline" onClick={onStop}>
            <Square className="size-3" />
            {t("Stop")}
          </Button>
        ) : null}
        <Button size="sm" onClick={send} disabled={!text.trim() || disabled || busy}>
          <Send className="size-3" />
          {t("Send")}
        </Button>
      </div>
    </div>
  );
}

function ActiveJobBar({ threadId }: { threadId: string }) {
  const t = useExtracted();
  const label = useJobStatusLabel();
  const jobs = useThreadJobs(threadId);
  const errorText = useRunErrorText();
  const invalidate = useInvalidateRun();
  const active = jobs.data?.jobs.find((job) =>
    ["queued", "running", "finalizing", "waiting_approval", "waiting_takeover"].includes(
      job.status,
    ),
  );
  const cancel = useMutation({
    mutationFn: (id: string) => runFetch(`jobs/${id}`, { body: { action: "cancel" } }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorText(error)),
  });
  if (!active) return null;
  const checkpoint = active.checkpoint as { text?: string } | null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="font-medium">{label(active.status)}</span>
        {checkpoint?.text ? (
          <span className="ml-2 truncate text-muted-foreground">{checkpoint.text.slice(-120)}</span>
        ) : null}
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate(active.id)}
      >
        <Square className="size-3" />
        {t("Stop task")}
      </Button>
    </div>
  );
}

function ThreadFrame({
  state,
  thread,
  children,
}: {
  state: RunState;
  thread: Thread;
  children: React.ReactNode;
}) {
  const t = useExtracted();
  const [panelOpen, setPanelOpen] = useState(false);
  const members = threadTeammates(state, thread);
  const invalidate = useInvalidateRun();
  const queryClient = useQueryClient();
  const errorText = useRunErrorText();
  const { push } = useRouter();
  const clear = useMutation({
    mutationFn: () => runFetch(`threads/${thread.id}/reset`, { body: { clear: true } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: runKeys.thread(thread.id) });
      await invalidate();
      window.location.reload();
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const remove = useMutation({
    mutationFn: () => runFetch(`threads/${thread.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await invalidate();
      push("/run");
    },
    onError: (error) => toast.error(errorText(error)),
  });
  return (
    <>
      <DocumentTitle title={thread.title} />
      <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-1 flex-col gap-3">
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex -space-x-2">
              {members.slice(0, 4).map((bot) => (
                <TeammateAvatar key={bot.id} name={bot.name} icon={bot.icon} accent={bot.accent} />
              ))}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">{thread.title}</h1>
              <p className="truncate text-xs text-muted-foreground">
                {thread.kind === "group"
                  ? members.map((bot) => bot.name).join(", ")
                  : members[0]?.job}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("Clear history")}
              disabled={clear.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    t("Delete this conversation's history? The teammate and its files stay."),
                  )
                )
                  clear.mutate();
              }}
            >
              <Eraser className="size-4" />
            </Button>
            {thread.kind === "group" ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("Delete group")}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(t("Delete this group? Its teammates stay."))) remove.mutate();
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setPanelOpen(true)}>
              <PanelRight className="size-4" />
              {t("Workspace")}
            </Button>
          </div>
        </header>
        <ActiveJobBar threadId={thread.id} />
        {children}
      </div>
      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("Workspace")}</SheetTitle>
            <SheetDescription>
              {t("Tasks, deliverables and the shared computer of this conversation.")}
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <RunWorkspacePanel threadId={thread.id} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function useMarkRead(thread: Thread) {
  const invalidate = useInvalidateRun();
  const unread = thread.unread;
  useEffect(() => {
    if (!unread) return;
    void runFetch(`threads/${thread.id}`, { method: "PATCH", body: { unread: false } })
      .then(() => invalidate(runKeys.state))
      .catch(() => undefined);
  }, [thread.id, unread, invalidate]);
}

function MessageList({
  messages,
  authorFor,
  showAuthors,
  onApprovalResponse,
  approvalsDisabled,
  streamingId,
  emptyText,
}: {
  messages: UIMessage[];
  authorFor: (message: UIMessage) => MessageAuthor | null;
  showAuthors: boolean;
  onApprovalResponse?: (approvalId: string, approved: boolean, message: UIMessage) => void;
  approvalsDisabled?: boolean;
  streamingId?: string | null;
  emptyText: string;
}) {
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent>
        {messages.length === 0 ? <ConversationEmptyState title={emptyText} /> : null}
        {messages.map((message) => (
          <RunMessage
            key={message.id}
            message={message}
            author={authorFor(message)}
            showAuthor={showAuthors}
            streaming={message.id === streamingId}
            approvalsDisabled={approvalsDisabled}
            onApprovalResponse={
              onApprovalResponse
                ? (approvalId, approved) => onApprovalResponse(approvalId, approved, message)
                : undefined
            }
          />
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

/** A direct conversation with one teammate, streamed through `/api/run/chat` (useChat). */
function DmThread({
  state,
  thread,
  initialMessages,
}: {
  state: RunState;
  thread: Thread;
  initialMessages: UIMessage[];
}) {
  const t = useExtracted();
  const invalidate = useInvalidateRun();
  const bot = threadTeammates(state, thread)[0];
  const jobs = useThreadJobs(thread.id);
  const waitingJobRef = useRef<string | undefined>(undefined);
  waitingJobRef.current = jobs.data?.jobs.find((job) =>
    ["waiting_approval", "waiting_takeover"].includes(job.status),
  )?.id;
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/run/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            threadId: thread.id,
            botId: bot?.id,
            messages: messages.slice(-1),
            ...(waitingJobRef.current ? { jobId: waitingJobRef.current } : {}),
          },
        }),
      }),
    [thread.id, bot?.id],
  );
  const { messages, sendMessage, status, stop, error, clearError, addToolApprovalResponse } =
    useChat({
      id: `run:${thread.id}`,
      messages: initialMessages,
      transport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
      onData: (part) => {
        if (part.type === "data-job-status") void invalidate(runKeys.jobs(thread.id));
      },
      onFinish: () => {
        void invalidate();
      },
    });
  const busy = status === "submitted" || status === "streaming";

  const sentPending = useRef(false);
  useEffect(() => {
    if (sentPending.current) return;
    sentPending.current = true;
    const pending = takePendingTask(thread.id);
    if (pending) void sendMessage({ text: pending });
  }, [thread.id, sendMessage]);

  const author: MessageAuthor | null = bot
    ? { id: bot.id, name: bot.name, accent: bot.accent, icon: bot.icon }
    : null;
  return (
    <>
      <MessageList
        messages={messages}
        authorFor={(message) => messageAuthorOf(message) ?? author}
        showAuthors={false}
        streamingId={busy ? messages.at(-1)?.id : null}
        approvalsDisabled={busy}
        onApprovalResponse={(id, approved) => void addToolApprovalResponse({ id, approved })}
        emptyText={t("Send {name} a task to get started.", { name: bot?.name ?? "" })}
      />
      {error ? <ChatErrorAlert error={error} onDismiss={clearError} /> : null}
      <Composer
        placeholder={t("Message {name}", { name: bot?.name ?? "" })}
        busy={busy}
        onStop={stop}
        onSend={(text) => void sendMessage({ text })}
      />
    </>
  );
}

type GroupStatus = { author: MessageAuthor; status: string; error?: string };

function parseFrames(buffer: string) {
  const frames: unknown[] = [];
  let rest = buffer;
  let separator: RegExpMatchArray | null;
  while ((separator = rest.match(/\r?\n\r?\n/))) {
    const index = separator.index ?? 0;
    const frame = rest.slice(0, index);
    rest = rest.slice(index + separator[0].length);
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      frames.push(JSON.parse(data));
    } catch {
      // A malformed frame is skipped.
    }
  }
  return { frames, rest };
}

/** A group conversation: `@name` / `@everyone` picks who answers; each reply is attributed. */
function GroupThread({
  state,
  thread,
  initialMessages,
}: {
  state: RunState;
  thread: Thread;
  initialMessages: UIMessage[];
}) {
  const t = useExtracted();
  const invalidate = useInvalidateRun();
  const members = threadTeammates(state, thread);
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [statuses, setStatuses] = useState<Record<string, GroupStatus>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const label = useJobStatusLabel();

  const upsert = (message: UIMessage) =>
    setMessages((current) => {
      const index = current.findIndex((item) => item.id === message.id);
      if (index === -1) return [...current, message];
      const next = [...current];
      next[index] = message;
      return next;
    });

  const post = async (input: UIMessage) => {
    setBusy(true);
    setError(undefined);
    setStatuses({});
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/run/group-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread.id, messages: [input] }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(await response.text());
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const parsed = parseFrames(buffer + value);
        buffer = parsed.rest;
        for (const frame of parsed.frames as { type?: string; data?: Record<string, unknown> }[]) {
          if (frame.type === "data-group-message" && frame.data?.message)
            upsert(frame.data.message as UIMessage);
          if (frame.type === "data-group-status" && frame.data?.author) {
            const status = frame.data as unknown as GroupStatus;
            setStatuses((current) => ({ ...current, [status.author.id]: status }));
          }
        }
      }
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setBusy(false);
      abortRef.current = null;
      void invalidate();
    }
  };

  const send = (text: string) => {
    const input: UIMessage = { id: generateId(), role: "user", parts: [{ type: "text", text }] };
    upsert(input);
    void post(input);
  };

  useEffect(() => {
    const pending = takePendingTask(thread.id);
    if (pending) send(pending);
    // Only on open.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id]);

  const respond = (approvalId: string, approved: boolean, message: UIMessage) => {
    const answered: UIMessage = {
      ...message,
      parts: message.parts.map((part) => {
        const value = part as { approval?: { id: string }; state?: string };
        return value.approval?.id === approvalId
          ? ({
              ...part,
              state: "approval-responded",
              approval: { ...value.approval, approved },
            } as UIMessage["parts"][number])
          : part;
      }),
    };
    upsert(answered);
    void post(answered);
  };

  const byId = new Map(members.map((bot) => [bot.id, bot]));
  return (
    <>
      <MessageList
        messages={messages}
        authorFor={(message) => {
          const author = messageAuthorOf(message);
          const bot = author ? byId.get(author.id) : undefined;
          return author ? { ...author, icon: bot?.icon } : null;
        }}
        showAuthors
        approvalsDisabled={busy}
        onApprovalResponse={respond}
        emptyText={t("Message the group. Use @name to pick who answers.")}
      />
      {Object.values(statuses).length ? (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {Object.values(statuses).map((status) => (
            <span key={status.author.id} className="rounded-full border px-2 py-0.5">
              {status.author.name}:{" "}
              {status.status === "working"
                ? label("running")
                : status.status === "failed"
                  ? label("failed")
                  : status.status === "completed"
                    ? label("completed")
                    : label("waiting_approval")}
            </span>
          ))}
        </div>
      ) : null}
      {error ? <ChatErrorAlert error={error} onDismiss={() => setError(undefined)} /> : null}
      <Composer
        placeholder={t("Message {name}", { name: thread.title })}
        busy={busy}
        onStop={() => abortRef.current?.abort()}
        onSend={send}
        mentions={members}
      />
    </>
  );
}

/** `/run/threads/$id`: a DM or a group conversation. */
export function RunThreadView({ threadId }: { threadId: string }) {
  const t = useExtracted();
  const state = useRunState();
  const thread = useRunThread(threadId);
  const errorText = useRunErrorText();
  if (state.isLoading || thread.isLoading) return <RunLoading />;
  if (thread.isError || state.isError || !state.data || !thread.data)
    return (
      <RunPage title={t("Conversation not found")}>
        <p className="text-sm text-muted-foreground">{errorText(thread.error ?? state.error)}</p>
      </RunPage>
    );
  const current = state.data.threads.find((item) => item.id === threadId) ?? thread.data.thread;
  return (
    <ThreadBody
      key={threadId}
      state={state.data}
      thread={current}
      initialMessages={thread.data.messages}
    />
  );
}

function ThreadBody({
  state,
  thread,
  initialMessages,
}: {
  state: RunState;
  thread: Thread;
  initialMessages: UIMessage[];
}) {
  useMarkRead(thread);
  return (
    <ThreadFrame state={state} thread={thread}>
      {thread.kind === "group" ? (
        <GroupThread state={state} thread={thread} initialMessages={initialMessages} />
      ) : (
        <DmThread state={state} thread={thread} initialMessages={initialMessages} />
      )}
    </ThreadFrame>
  );
}
