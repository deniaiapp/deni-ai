import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useChat } from "@ai-sdk/react";
import { useMutation } from "@tanstack/react-query";
import {
  DefaultChatTransport,
  generateId,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import {
  Loader2Icon,
  Monitor as MonitorIcon,
  RotateCcw as RotateCcwIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { useExtracted } from "use-intl";
import type { RunMode } from "@deniai/run/agent/model";
import { isContextReset } from "@deniai/run/chat/messages";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@deniai/ui/components/alert";
import { Button } from "@deniai/ui/components/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@deniai/ui/components/sheet";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { DocumentTitle } from "@/components/document-title";
import { Link, useRouter } from "@/lib/navigation";
import { cn } from "@/lib/utils";
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
import { RunComposer, useRunMode } from "./run-composer";
import { useRunErrorText } from "./run-error-text";
import {
  messageAuthorOf,
  RunMessage,
  TeammateEmptyState,
  TypingIndicator,
  type MessageAuthor,
} from "./run-message";
import { RunLoading, RunPage, takePendingTask } from "./run-page";
import { RunWorkspacePanel } from "./run-workspace-panel";
import { TeammateAvatar } from "./teammate-avatar";

const ACTIVE_JOB = ["queued", "running", "finalizing", "waiting_approval", "waiting_takeover"];

/** The error the Run chat endpoints answered with: a code and, when present, detail text. */
function parseChatError(error: Error | undefined) {
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
  let title = t("Failed to send");
  let description = parsed?.message ?? t("Something went wrong. Please try again.");
  let action: ReactNode = null;
  if (parsed?.code === "llm_unconfigured") {
    title = t("No AI model is configured");
    description = t(
      "Teammates cannot answer until an OpenRouter key is configured for Run on this server.",
    );
  } else if (parsed?.code === "usage_limit") {
    title = t("Usage limit reached");
    description = t("This month's usage is used up. Upgrade your plan to keep going.");
    action = (
      <Button size="xs" render={<Link href="/settings/billing" />} nativeButton={false}>
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
        <Button size="xs" variant="ghost" onClick={onDismiss}>
          {t("Dismiss")}
        </Button>
      </AlertAction>
    </Alert>
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

/** The thread's running background job, if any. */
function useActiveJob(threadId: string) {
  const jobs = useThreadJobs(threadId);
  return jobs.data?.jobs.find((job) => ACTIVE_JOB.includes(job.status));
}

/**
 * The frame of a conversation, laid out like Deni Run: a header bar with the teammate and
 * Stop / Reset / Clear, the messages, and the message box at the bottom.
 */
function ThreadLayout({
  state,
  thread,
  messages,
  busy,
  onStop,
  onMessagesReplaced,
  subheader,
  children,
  footer,
}: {
  state: RunState;
  thread: Thread;
  messages: UIMessage[];
  busy: boolean;
  onStop: () => void;
  onMessagesReplaced: (messages: UIMessage[]) => void;
  subheader?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  const t = useExtracted();
  const [panelOpen, setPanelOpen] = useState(false);
  const members = threadTeammates(state, thread);
  const bot = members[0];
  const group = thread.kind === "group";
  const invalidate = useInvalidateRun();
  const errorText = useRunErrorText();
  const { push } = useRouter();
  const activeJob = useActiveJob(thread.id);
  const savingResult = activeJob?.status === "finalizing";
  const waitingForUser =
    activeJob?.status === "waiting_approval" || activeJob?.status === "waiting_takeover";
  const working = busy || Boolean(activeJob);
  const title = group ? thread.title : (bot?.name ?? thread.title);

  const reset = useMutation({
    mutationFn: (clear: boolean) =>
      runFetch<{ messages: UIMessage[] }>(`threads/${thread.id}/reset`, {
        body: clear ? { clear: true } : {},
      }),
    onSuccess: async (result) => {
      onMessagesReplaced(result.messages);
      await invalidate();
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
  const last = messages.at(-1);

  return (
    <>
      <DocumentTitle title={title} />
      <section className="-m-3 flex min-h-0 min-w-0 flex-1 flex-col md:-m-5">
        <header className="flex h-[54px] shrink-0 items-center gap-2.5 border-b px-3 md:px-4">
          <TeammateAvatar
            name={title}
            icon={group ? thread.icon || "👥" : bot?.icon}
            accent={group ? null : bot?.accent}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold">{title}</span>
            <span className="truncate text-xs text-muted-foreground">
              {group ? members.map((item) => item.name).join(" · ") : bot?.job}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {working && savingResult ? (
              <span className="text-xs text-muted-foreground">{t("Saving result…")}</span>
            ) : working && waitingForUser ? (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                {t("Waiting for your help…")}
              </span>
            ) : working ? (
              <Button
                type="button"
                variant="destructive"
                size="xs"
                onClick={onStop}
                className="gap-1"
              >
                <SquareIcon className="size-3" />
                {t("Stop")}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={
                    reset.isPending || messages.length === 0 || (last && isContextReset(last))
                  }
                  title={t("Earlier messages stay here but are no longer sent to the model.")}
                  onClick={() => reset.mutate(false)}
                  className="hidden sm:inline-flex"
                >
                  <RotateCcwIcon className="size-3" />
                  {t("Reset conversation")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={reset.isPending || messages.length === 0}
                  title={t("Clear conversation")}
                  aria-label={t("Clear conversation")}
                  onClick={() => {
                    if (
                      window.confirm(
                        t("Delete this conversation's history? The teammate and its files stay."),
                      )
                    )
                      reset.mutate(true);
                  }}
                >
                  <Trash2Icon />
                </Button>
              </>
            )}
            {group && !working ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(t("Delete this group? Its teammates stay."))) remove.mutate();
                }}
              >
                {t("Delete group")}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="xs" onClick={() => setPanelOpen(true)}>
              <MonitorIcon className="size-3" />
              <span className="hidden sm:inline">{t("Computer")}</span>
            </Button>
          </div>
        </header>
        {subheader}
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto min-h-full w-full max-w-3xl gap-5 px-4 py-6 lg:px-5">
            {children}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <div className="relative mx-auto w-full max-w-3xl shrink-0 px-3 pt-2 pb-4 md:px-4">
          {footer}
        </div>
      </section>
      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("Computer")}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">
            <RunWorkspacePanel threadId={thread.id} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** True while the newest reply has no text yet, so the typing dots stand in for it. */
function awaitingReply(messages: UIMessage[]) {
  const last = messages.at(-1);
  if (!last || last.role === "user") return true;
  return !last.parts.some((part) => part.type === "text" && part.text.trim());
}

function useCancelJob(threadId: string) {
  const invalidate = useInvalidateRun();
  const errorText = useRunErrorText();
  const activeJob = useActiveJob(threadId);
  const cancel = useMutation({
    mutationFn: (id: string) => runFetch(`jobs/${id}`, { body: { action: "cancel" } }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorText(error)),
  });
  return () => {
    if (activeJob) cancel.mutate(activeJob.id);
  };
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
  const [runMode, setRunMode] = useRunMode(state);
  const [input, setInput] = useState("");
  const jobs = useThreadJobs(thread.id);
  const activeJob = jobs.data?.jobs.find((job) => ACTIVE_JOB.includes(job.status));
  const cancelJob = useCancelJob(thread.id);
  const requestRef = useRef<{ jobId?: string; runMode: RunMode }>({ runMode });
  requestRef.current = {
    jobId: jobs.data?.jobs.find((job) =>
      ["waiting_approval", "waiting_takeover"].includes(job.status),
    )?.id,
    runMode,
  };
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/run/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            threadId: thread.id,
            botId: bot?.id,
            messages: messages.slice(-1),
            runMode: requestRef.current.runMode,
            ...(requestRef.current.jobId ? { jobId: requestRef.current.jobId } : {}),
          },
        }),
      }),
    [thread.id, bot?.id],
  );
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    error,
    clearError,
    addToolApprovalResponse,
  } = useChat({
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
  const streaming = status === "submitted" || status === "streaming";
  const working = streaming || activeJob?.status === "queued" || activeJob?.status === "running";

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
  const stopAll = () => {
    void stop();
    cancelJob();
  };

  return (
    <ThreadLayout
      state={state}
      thread={thread}
      messages={messages}
      busy={streaming}
      onStop={stopAll}
      onMessagesReplaced={setMessages}
      footer={
        <RunComposer
          value={input}
          onValueChange={setInput}
          onSubmit={(text) => {
            setInput("");
            void sendMessage({ text });
          }}
          onStop={stopAll}
          busy={streaming}
          placeholder={t("Message {name}", { name: bot?.name ?? "" })}
          runMode={runMode}
          onRunModeChange={setRunMode}
        />
      }
    >
      {messages.length === 0 && !working ? (
        <TeammateEmptyState name={bot?.name ?? thread.title} job={bot?.job} />
      ) : null}
      {messages.map((message, index) => (
        <RunMessage
          key={message.id || `message-${index}`}
          message={message}
          author={messageAuthorOf(message) ?? author}
          showAuthor={false}
          streaming={streaming && index === messages.length - 1}
          approvalsDisabled={streaming}
          onApprovalResponse={(id, approved) => void addToolApprovalResponse({ id, approved })}
        />
      ))}
      {working && awaitingReply(messages) ? <TypingIndicator /> : null}
      {error ? <ChatErrorAlert error={error} onDismiss={clearError} /> : null}
    </ThreadLayout>
  );
}

type GroupStatus = {
  author: MessageAuthor;
  status: string;
  error?: string;
  messageId?: string;
};

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

function GroupStatuses({ statuses, bots }: { statuses: GroupStatus[]; bots: Bot[] }) {
  const t = useExtracted();
  return (
    <div className="shrink-0 border-b px-4 py-2">
      <p className="text-[11px] text-muted-foreground">
        {t("@everyone to ask everyone · @name to ask a teammate")}
      </p>
      {statuses.length ? (
        <div
          className="mt-2 flex flex-wrap gap-2"
          role="status"
          aria-label={t("Teammate responses")}
        >
          {statuses.map((item) => (
            <div
              key={item.author.id}
              title={item.error}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px]",
                item.status === "failed"
                  ? "border-destructive/30 text-destructive"
                  : "text-muted-foreground",
              )}
            >
              <TeammateAvatar
                name={item.author.name}
                accent={item.author.accent}
                icon={bots.find((bot) => bot.id === item.author.id)?.icon}
                size="sm"
                className="size-5"
              />
              <span>{item.author.name}</span>
              {["working", "finalizing"].includes(item.status) ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <span>
                  {item.status === "waiting"
                    ? t("Needs your help")
                    : item.status === "failed"
                      ? t("Failed")
                      : t("Done")}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
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
  const [runMode, setRunMode] = useRunMode(state);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [statuses, setStatuses] = useState<Record<string, GroupStatus>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const cancelJob = useCancelJob(thread.id);

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
    const message: UIMessage = { id: generateId(), role: "user", parts: [{ type: "text", text }] };
    upsert(message);
    void post(message);
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

  const stopAll = () => {
    abortRef.current?.abort();
    cancelJob();
  };
  const byId = new Map(members.map((bot) => [bot.id, bot]));
  const statusList = Object.values(statuses);
  const working = statusList.some((item) => ["working", "finalizing"].includes(item.status));

  return (
    <ThreadLayout
      state={state}
      thread={thread}
      messages={messages}
      busy={busy}
      onStop={stopAll}
      onMessagesReplaced={setMessages}
      subheader={<GroupStatuses statuses={statusList} bots={members} />}
      footer={
        <RunComposer
          value={input}
          onValueChange={setInput}
          onSubmit={(text) => {
            setInput("");
            send(text);
          }}
          onStop={stopAll}
          busy={busy}
          placeholder={t("Message {name} · @everyone", { name: thread.title })}
          runMode={runMode}
          onRunModeChange={setRunMode}
          mentions={members}
        />
      }
    >
      {messages.length === 0 ? (
        <TeammateEmptyState name={thread.title} job={members.map((bot) => bot.name).join(" · ")} />
      ) : null}
      {messages.map((message, index) => {
        const author = messageAuthorOf(message);
        const bot = author ? byId.get(author.id) : undefined;
        const memberState = author ? statuses[author.id] : undefined;
        return (
          <RunMessage
            key={message.id || `message-${index}`}
            message={message}
            author={author ? { ...author, icon: bot?.icon } : null}
            showAuthor
            streaming={memberState?.messageId === message.id && memberState.status === "working"}
            approvalsDisabled={busy}
            onApprovalResponse={(id, approved) => respond(id, approved, message)}
          />
        );
      })}
      {busy && !working && awaitingReply(messages) ? <TypingIndicator /> : null}
      {error ? <ChatErrorAlert error={error} onDismiss={() => setError(undefined)} /> : null}
    </ThreadLayout>
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
  return thread.kind === "group" ? (
    <GroupThread state={state} thread={thread} initialMessages={initialMessages} />
  ) : (
    <DmThread state={state} thread={thread} initialMessages={initialMessages} />
  );
}
