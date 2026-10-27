import { useChat } from "@ai-sdk/react";
import { useExtracted } from "@/i18n/react";
import { type UIMessage } from "ai";
import {
  Fragment,
  memo,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { easeOut } from "@/lib/motion";
import { LinkSimpleIcon, RobotIcon, StopIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
  ArchiveIcon,
  BookOpenIcon,
  ClockIcon,
  DownloadIcon,
  FolderIcon,
  GlobeIcon,
  HistoryIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  TerminalIcon,
  RotateCcwIcon,
  WrenchIcon,
  CornerUpLeftIcon,
  XIcon,
  CheckIcon,
  ChevronRightIcon,
  Loader2Icon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import {
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
} from "@/components/ai-elements/chain-of-thought";
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Attachment, Attachments } from "@/components/ai-elements/attachments";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Avatar } from "./sidebar";
import { MessageActions } from "./message-actions";
import { Composer, type ComposerMessage } from "./composer";
import {
  ChatComposerActionMenu,
  ChatComposerTools,
  ChatComposerVoiceInput,
} from "./chat-composer-controls";
import { useConnectDeniAi } from "./billing-dialog";
import { usePluginActionLabels } from "./plugin-action-labels";
import { mcpArgumentPreview, mcpToolKind, mcpToolTitle, useMcpConnectionNames } from "./mcp-tool-labels";
import { McpApprovalDetails } from "./mcp-approval";
import {
  messageActionKey,
  messageBubbleTargets,
  replyReference,
  type MessageBubble,
  type MessageReference,
  type MessageReaction,
} from "@/lib/message-actions";
import { usesBubbleBreaks } from "@/lib/message-bubbles";
import { messageAttachments } from "@/lib/message-attachments";
import { createReactionState, type ReactionMap } from "@/lib/reaction-state";
import { messageAuthor, type MessageAuthor } from "@/lib/group-chat";
import { isCompaction, isContextReset, workedMsOf } from "@/lib/messages";
import type { RunMode } from "@/lib/model";
import { isUsageLimitError } from "@/lib/plans";
import type {
  AgentJob,
  Artifact,
  Bot,
  HandoffSnapshot,
  Thread,
} from "@/lib/types";
import { isActiveJob, latestJob, mergeJobSnapshots } from "@/lib/job-view";
import {
  clearThreadDraft,
  getThreadDraft,
  setThreadDraft,
} from "@/lib/thread-state";
import type { Chat } from "@ai-sdk/react";
import {
  getChatSessionRunStatus,
  setChatSessionRunStatus,
  subscribeChatSessionRunStatus,
  getGroupReplyStatuses,
  subscribeGroupReplyStatuses,
  approveGroupTool,
} from "@/lib/chat-sessions";

const draftCache = new Map<string, string>();
const scrollCache = new Map<string, number>();
const replyCache = new Map<string, MessageReference>();
const reactionStates = new Map<
  string,
  ReturnType<typeof createReactionState>
>();

export function forgetChatThread(threadId: string) {
  draftCache.delete(threadId);
  scrollCache.delete(threadId);
  replyCache.delete(threadId);
  reactionStates.delete(threadId);
}

function getReactionState(threadId: string, initial: ReactionMap = {}) {
  const existing = reactionStates.get(threadId);
  if (existing) return existing;
  const state = createReactionState(async (messageId, emoji, selected) => {
    const response = await fetch(
      `/api/threads/${encodeURIComponent(threadId)}/reactions`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, emoji, selected }),
      },
    );
    if (!response.ok) throw new Error("Reaction could not be saved");
    return ((await response.json()) as { reactions: ReactionMap }).reactions;
  }, initial);
  reactionStates.set(threadId, state);
  for (const [key, entry] of reactionStates) {
    if (reactionStates.size <= 100) break;
    if (key !== threadId && !entry.hasPending()) reactionStates.delete(key);
  }
  return state;
}

function rememberScroll(threadId: string, scrollTop: number) {
  scrollCache.delete(threadId);
  scrollCache.set(threadId, scrollTop);
  while (scrollCache.size > 100)
    scrollCache.delete(scrollCache.keys().next().value as string);
}

export function ChatThread({
  thread,
  bot,
  bots,
  runMode,
  onRunModeChange,
  onBusyChange,
  onActiveJobChange,
  onResetConversation,
  resetting = false,
  backgroundJobs,
  onJobsChange,
  chat,
}: {
  thread: Thread;
  bot: Bot;
  bots: Bot[];
  runMode: RunMode;
  onRunModeChange: (mode: RunMode) => void | Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onActiveJobChange?: (jobId: string | null) => void;
  onResetConversation?: () => void;
  resetting?: boolean;
  backgroundJobs?: AgentJob[];
  onJobsChange?: (jobs: AgentJob[]) => void;
  chat: Chat<UIMessage>;
}) {
  const t = useExtracted();
  const conversationContextRef = useRef<StickToBottomContext | null>(null);
  const {
    messages,
    sendMessage,
    status,
    addToolApprovalResponse,
    setMessages,
    stop,
    error,
    clearError,
  } = useChat({ chat });

  const [input, setInput] = useState(() =>
    getThreadDraft(draftCache, thread.id),
  );
  const [mentionCursor, setMentionCursor] = useState(-1);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const groupMembers = bots.filter((member) =>
    thread.botIds.includes(member.id),
  );
  const mentionPrefix = mentionCursor >= 0 ? input.slice(0, mentionCursor) : "";
  const mention =
    thread.kind === "group"
      ? mentionPrefix.match(/(?:^|\s)@([^@\n]{0,48})$/)
      : null;
  const mentionOptions = mention
    ? [
        { id: "everyone", name: "everyone", accent: "#525252" },
        ...groupMembers,
      ].filter((member) =>
        member.name.toLowerCase().startsWith(mention[1].toLowerCase()),
      )
    : [];
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [replyTarget, setReplyTarget] = useState<MessageReference | null>(
    () => replyCache.get(thread.id) ?? null,
  );
  const reactionState = useMemo(
    () => getReactionState(thread.id, thread.reactions),
    [thread.id, thread.reactions],
  );
  const reactions = useSyncExternalStore(
    reactionState.subscribe,
    reactionState.getSnapshot,
    reactionState.getSnapshot,
  );
  const [handoffs, setHandoffs] = useState<Record<string, HandoffSnapshot>>({});
  const [jobs, setJobs] = useState<AgentJob[]>(backgroundJobs ?? []);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const syncedCompletion = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const taskRefreshSequence = useRef(0);
  const jobsChangeRef = useRef(onJobsChange);
  const displayedJobs = backgroundJobs ?? jobs;
  const usesSharedJobs = backgroundJobs !== undefined;
  const sharedJobSignal = backgroundJobs
    ?.map((job) => `${job.id}:${job.status}:${job.attempt}`)
    .join("|");
  const displayedJobsRef = useRef(displayedJobs);

  useEffect(() => {
    const controller = new AbortController();
    const revision = reactionState.getRevision();
    void fetch(`/api/threads/${encodeURIComponent(thread.id)}/reactions`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as {
          reactions: Record<string, string[]>;
        };
        if (!controller.signal.aborted)
          reactionState.hydrate(data.reactions, revision);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [thread.id, reactionState]);

  const replyToMessage = useCallback(
    (reference: MessageReference) => {
      setReplyTarget(reference);
      replyCache.delete(thread.id);
      replyCache.set(thread.id, reference);
      while (replyCache.size > 100)
        replyCache.delete(replyCache.keys().next().value as string);
      requestAnimationFrame(() => {
        const textarea = inputRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(
          textarea.value.length,
          textarea.value.length,
        );
      });
    },
    [setReplyTarget, thread.id],
  );

  const reactToMessage = useCallback(
    (messageId: string, emoji: MessageReaction, selected: boolean) =>
      reactionState.toggle(messageId, emoji, selected),
    [reactionState],
  );

  const locateMessage = useCallback((key: string) => {
    const element =
      conversationContextRef.current?.scrollRef.current?.querySelector<HTMLElement>(
        `[data-message-key="${CSS.escape(key)}"]`,
      );
    if (!element) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    element.scrollIntoView({
      behavior: reduced ? "instant" : "smooth",
      block: "center",
    });
    element.focus({ preventScroll: true });
    if (!reduced)
      element.animate(
        [{ backgroundColor: "color-mix(in srgb, var(--color-white) 9.4%, transparent)" }, { backgroundColor: "transparent" }],
        { duration: 1100 },
      );
  }, []);

  useEffect(() => {
    jobsChangeRef.current = onJobsChange;
  }, [onJobsChange]);

  useEffect(() => {
    displayedJobsRef.current = displayedJobs;
  }, [displayedJobs]);

  useEffect(() => {
    const scrollElement = conversationContextRef.current?.scrollRef.current;
    const savedScrollTop = scrollCache.get(thread.id);
    let frame: number | undefined;
    if (savedScrollTop != null) {
      frame = requestAnimationFrame(() => {
        const element = conversationContextRef.current?.scrollRef.current;
        if (element) element.scrollTop = savedScrollTop;
      });
    }
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      if (scrollElement) rememberScroll(thread.id, scrollElement.scrollTop);
    };
  }, [thread.id]);

  const onApprove = useCallback(
    async (id: string, approved: boolean) => {
      setApprovalError(null);
      if (thread.kind === "group") {
        try {
          await approveGroupTool(thread.id, id, approved);
        } catch (error) {
          setApprovalError(
            error instanceof Error
              ? error.message
              : t("Could not submit approval."),
          );
        }
        return;
      }
      setChatSessionRunStatus(thread.id, "working");
      // The chat request resumes the job together with the approval response.
      // Do not queue old input for the background worker before approval is sent.
      addToolApprovalResponse({ id, approved });
    },
    [addToolApprovalResponse, t, thread.id, thread.kind],
  );

  const busy = status === "submitted" || status === "streaming";
  const subscribeRunStatus = useCallback(
    (listener: () => void) =>
      subscribeChatSessionRunStatus(thread.id, listener),
    [thread.id],
  );
  const chatRunStatus = useSyncExternalStore(
    subscribeRunStatus,
    () => getChatSessionRunStatus(thread.id),
    () => "idle",
  );
  const subscribeGroupStatuses = useCallback(
    (listener: () => void) => subscribeGroupReplyStatuses(thread.id, listener),
    [thread.id],
  );
  const groupStatuses = useSyncExternalStore(
    subscribeGroupStatuses,
    () => getGroupReplyStatuses(thread.id),
    () => getGroupReplyStatuses(thread.id),
  );
  const activeJob = latestJob(displayedJobs.filter(isActiveJob));
  const savingResult =
    thread.kind === "group"
      ? Object.values(groupStatuses).some(
          (item) => item.status === "finalizing",
        ) &&
        !Object.values(groupStatuses).some((item) => item.status === "working")
      : activeJob?.status === "finalizing" || chatRunStatus === "finalizing";
  const waitingForUser = chatRunStatus === "waiting";
  const showBusyIndicator =
    busy && chatRunStatus !== "completed" && chatRunStatus !== "failed";
  const replyInProgress =
    thread.kind === "group"
      ? Object.values(groupStatuses).some((item) => item.status === "working")
      : showBusyIndicator && !savingResult && !waitingForUser;

  const refreshTaskData = useCallback(
    async (signal?: AbortSignal, forceJobs = false) => {
      const sequence = ++taskRefreshSequence.current;
      const [jobsResponse, artifactsResponse] = await Promise.all([
        !usesSharedJobs || forceJobs
          ? fetch(`/api/jobs?threadId=${encodeURIComponent(thread.id)}`, {
              cache: "no-store",
              signal,
            })
          : Promise.resolve(null),
        fetch(`/api/artifacts?threadId=${encodeURIComponent(thread.id)}`, {
          cache: "no-store",
          signal,
        }),
      ]);
      if (!mountedRef.current || sequence !== taskRefreshSequence.current)
        return;
      let nextJobs = displayedJobsRef.current;
      if (jobsResponse?.ok) {
        const json = (await jobsResponse.json()) as { jobs?: AgentJob[] };
        nextJobs = mergeJobSnapshots(displayedJobsRef.current, json.jobs ?? []);
        setJobs(nextJobs);
        jobsChangeRef.current?.(nextJobs);
      }
      const active = latestJob(nextJobs.filter(isActiveJob));
      onActiveJobChange?.(active?.id ?? null);
      const current = latestJob(nextJobs);
      if (
        !busy &&
        !active &&
        current?.status === "completed" &&
        syncedCompletion.current !== current.id
      ) {
        syncedCompletion.current = current.id;
        void fetch(`/api/threads/${thread.id}`, { cache: "no-store", signal })
          .then((response) => {
            if (!response.ok)
              throw new Error("Could not load completed messages");
            return response.json();
          })
          .then((json) => {
            if (
              mountedRef.current &&
              !signal?.aborted &&
              chat.status !== "streaming" &&
              chat.status !== "submitted" &&
              !displayedJobsRef.current.some(isActiveJob)
            )
              setMessages(json.messages ?? []);
          })
          .catch(() => {
            if (syncedCompletion.current === current.id)
              syncedCompletion.current = null;
          });
      }
      if (artifactsResponse.ok) {
        const json = (await artifactsResponse.json()) as {
          artifacts?: Artifact[];
        };
        setArtifacts(json.artifacts ?? []);
      }
    },
    [busy, chat, onActiveJobChange, setMessages, thread.id, usesSharedJobs],
  );

  useEffect(() => {
    // Polling rehydrates durable jobs after a disconnected chat request.
    const controller = new AbortController();
    let inFlight = true;
    // eslint-disable-next-line react/set-state-in-effect
    void refreshTaskData(controller.signal)
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
      });
    const timer = usesSharedJobs
      ? undefined
      : setInterval(() => {
          if (inFlight || document.visibilityState === "hidden") return;
          inFlight = true;
          void refreshTaskData(controller.signal)
            .catch(() => undefined)
            .finally(() => {
              inFlight = false;
            });
        }, 5_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refreshTaskData, sharedJobSignal, usesSharedJobs]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stopTask = useCallback(() => {
    stop();
    const ids = new Set(
      displayedJobs
        .filter((item) =>
          [
            "queued",
            "running",
            "waiting_approval",
            "waiting_takeover",
          ].includes(item.status),
        )
        .map((job) => job.id),
    );
    for (const item of Object.values(groupStatuses))
      if (item.jobId && ["working", "waiting"].includes(item.status))
        ids.add(item.jobId);
    for (const id of ids) {
      void fetch(`/api/jobs/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      }).then(() => refreshTaskData());
    }
  }, [displayedJobs, groupStatuses, refreshTaskData, stop]);

  const requestRevision = useCallback(
    (artifact: Artifact) => {
      const next = `Revise the artifact "${artifact.title}" at ${artifact.path} and register the updated file.`;
      setInput(next);
      draftCache.set(thread.id, next);
    },
    [thread.id],
  );

  useEffect(() => {
    const ids = collectHandoffIds(messages);
    if (ids.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = async () => {
      const res = await fetch("/api/handoffs");
      const json = (await res.json()) as { handoffs?: HandoffSnapshot[] };
      if (cancelled) return;
      const byId = new Map(
        (json.handoffs ?? []).map((item) => [item.id, item]),
      );
      const next: Record<string, HandoffSnapshot> = {};
      for (const id of ids) {
        const item = byId.get(id);
        if (item) next[id] = item;
      }
      setHandoffs(next);
      if (
        timer &&
        Object.values(next).every((item) => item.status !== "running")
      ) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    void tick();
    timer = setInterval(() => void tick(), 1200);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [messages]);

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  function submit({ files }: ComposerMessage) {
    const text = input.trim();
    // Files alone run no turn, the same as in Discord; they wait for a message.
    if (!text || busy) return false;
    setChatSessionRunStatus(thread.id, "working");
    setInput("");
    clearThreadDraft(draftCache, thread.id);
    setMentionCursor(-1);
    setAttachmentError(null);
    const metadata = {
      ...(replyTarget ? { replyTo: replyTarget } : {}),
      ...(files.length ? { attachments: files } : {}),
    };
    sendMessage({
      text,
      ...(Object.keys(metadata).length ? { metadata } : {}),
    });
    setReplyTarget(null);
    replyCache.delete(thread.id);
  }

  function insertMention(name: string) {
    const start = mentionPrefix.lastIndexOf("@");
    if (start < 0) return;
    const next = `${input.slice(0, start)}@${name} ${input.slice(mentionCursor)}`;
    const cursor = start + name.length + 2;
    setInput(next);
    setThreadDraft(draftCache, thread.id, next);
    setMentionCursor(-1);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      <motion.header
        className="hidden h-[54px] shrink-0 items-center gap-2.5 border-b border-foreground/10 bg-surface-8 px-4 md:flex"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: easeOut }}
      >
        <Avatar
          name={thread.kind === "group" ? thread.title : bot.name}
          accent={thread.kind === "group" ? "#454545" : bot.accent}
          icon={thread.kind === "group" ? thread.icon || "👥" : bot.icon}
        />
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex flex-col">
            <span className="min-w-0 truncate font-semibold text-foreground">
              {thread.kind === "group" ? thread.title : bot.name}
            </span>
            <span className="min-w-0 truncate text-xs text-neutral-119">
              {thread.kind === "group"
                ? bots
                    .filter((item) => thread.botIds.includes(item.id))
                    .map((item) => item.name)
                    .join(" · ")
                : bot.job}
            </span>
          </div>
        </div>
        {showBusyIndicator && !savingResult && !waitingForUser ? (
          <Button
            type="button"
            variant="secondary-destructive"
            size="xs"
            icon={StopIcon}
            onClick={stopTask}
          >
            {t("Stop")}
          </Button>
        ) : showBusyIndicator && savingResult ? (
          <span className="text-xs tracking-tighter text-muted-foreground">
            {t("Saving result…")}
          </span>
        ) : showBusyIndicator && waitingForUser ? (
          <span className="text-xs tracking-tighter text-warning-300">
            {t("Waiting for your help…")}
          </span>
        ) : onResetConversation ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            icon={RotateCcwIcon}
            loading={resetting}
            disabled={busy || messages.length === 0 || isContextReset(messages[messages.length - 1])}
            title={t("Earlier messages stay here but are no longer sent to the model.")}
            onClick={onResetConversation}
          >
            {t("Reset conversation")}
          </Button>
        ) : null}
      </motion.header>

      {thread.kind === "group" ? (
        <div className="shrink-0 border-b border-foreground/5 px-4 py-2">
          <p className="text-[11px] text-neutral-500">
            {t("@everyone to ask everyone · @name to ask a teammate")}
          </p>
          {Object.values(groupStatuses).length ? (
            <div
              className="mt-2 flex flex-wrap gap-2"
              role="status"
              aria-label={t("Teammate responses")}
            >
              {Object.values(groupStatuses).map((item) => (
                <div
                  key={item.author.id}
                  title={item.error}
                  className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] ${item.status === "failed" ? "border-destructive-400/20 text-destructive-300" : "border-foreground/10 text-neutral-400"}`}
                >
                  <span className="[&>span]:size-5">
                    <Avatar
                      name={item.author.name}
                      accent={item.author.accent}
                      icon={bots.find((bot) => bot.id === item.author.id)?.icon}
                    />
                  </span>
                  <span>{item.author.name}</span>
                  {["working", "finalizing"].includes(item.status) ? (
                    <Loader2Icon size={11} className="animate-spin" />
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
          {Object.values(groupStatuses)
            .filter((item) => item.error)
            .map((item) => (
              <p key={item.author.id} className="mt-1 text-xs text-destructive-300">
                {item.author.name}: {item.error}
              </p>
            ))}
        </div>
      ) : null}

      <Conversation
        contextRef={conversationContextRef}
        className="min-h-0 flex-1"
        onScroll={(event) =>
          rememberScroll(thread.id, event.currentTarget.scrollTop)
        }
      >
        <ConversationContent className="max-w-none gap-5 px-4 py-6 md:px-4 lg:px-5">
          {messages.length === 0 ? (
            <ConversationEmptyState>
              <EmptyState bot={bot} />
            </ConversationEmptyState>
          ) : (
            messages.map((message, index) => {
              if (isContextReset(message))
                return <ContextResetDivider key={message.id} />;
              if (isCompaction(message))
                return <CompactionDivider key={message.id} />;
              const author = messageAuthor(message);
              const memberState = author ? groupStatuses[author.id] : undefined;
              const groupReplyActive =
                memberState?.messageId === message.id &&
                ["working", "finalizing"].includes(memberState?.status ?? "");
              return (
                <MessageBlock
                  key={message.id || `message-${index}`}
                  workKey={`${thread.id}:${index}`}
                  message={message}
                  isLastMessage={
                    thread.kind === "group"
                      ? groupReplyActive
                      : index === messages.length - 1
                  }
                  isStreaming={
                    thread.kind === "group"
                      ? groupReplyActive && memberState?.status === "working"
                      : showBusyIndicator && !savingResult && !waitingForUser
                  }
                  onApprove={onApprove}
                  handoffs={handoffs}
                  bots={bots}
                  actionKey={messageActionKey(message, index)}
                  bubbles={messageBubbleTargets(message, index)}
                  onLocate={locateMessage}
                  author={author}
                  showAuthor={thread.kind === "group"}
                  authorIcon={bots.find((bot) => bot.id === author?.id)?.icon}
                  reactions={reactions}
                  onReply={replyToMessage}
                  onReact={reactToMessage}
                  actionsDisabled={
                    thread.kind === "group"
                      ? groupReplyActive
                      : busy && index === messages.length - 1
                  }
                />
              );
            })
          )}
          {replyInProgress ? <TypingIndicator /> : null}
          {showBusyIndicator && (waitingForUser || savingResult) ? (
            <span className="text-xs text-muted-foreground">
              {waitingForUser ? t("Waiting for your help") : t("Saving result")}
              <AnimatedDots />
            </span>
          ) : null}
          {artifacts.length > 0 ? (
            <ArtifactList artifacts={artifacts} onRevision={requestRevision} />
          ) : null}
          {isUsageLimitError(error) && error.metric === "link" ? (
            <ConnectDeniAiAlert onDismiss={clearError} />
          ) : error || approvalError ? (
            <Alert variant="destructive">
              <WarningCircleIcon weight="fill" />
              <AlertTitle>{t("Failed to send")}</AlertTitle>
              <AlertDescription>
                <p>{error?.message ?? approvalError}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    clearError();
                    setApprovalError(null);
                  }}
                  className="-ml-2"
                >
                  {t("Dismiss")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </ConversationContent>
      </Conversation>

      <div className="relative shrink-0 bg-background px-3 pb-4 pt-2 md:px-4">
        {mentionOptions.length ? (
          <div
            id={`mentions-${thread.id}`}
            role="listbox"
            aria-label={t("Mention a teammate")}
            className="absolute bottom-full left-4 z-20 mb-1 max-h-64 w-72 max-w-[calc(100%_-_2rem)] overflow-y-auto rounded-xl border border-foreground/10 bg-surface-32 p-1.5 shadow-xl"
          >
            {mentionOptions.map((member, index) => (
              <button
                key={member.id}
                id={`mention-${thread.id}-${index}`}
                type="button"
                role="option"
                aria-selected={index === mentionIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMention(member.name)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${index === mentionIndex ? "bg-foreground/10" : "hover:bg-foreground/5"}`}
              >
                {member.id === "everyone" ? (
                  <span className="flex size-8 items-center justify-center rounded-full bg-foreground/10">
                    <UsersIcon size={16} />
                  </span>
                ) : (
                  <Avatar
                    name={member.name}
                    accent={member.accent}
                    icon={bots.find((bot) => bot.id === member.id)?.icon}
                  />
                )}
                <span>@{member.name}</span>
                {member.id === "everyone" ? (
                  <span className="ml-auto text-xs text-neutral-500">
                    {t("All teammates")}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
        {replyTarget ? (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-foreground/10 bg-surface-32 px-3 py-2">
            <MessageReferenceCard
              reference={replyTarget}
              botName={bot.name}
              onLocate={locateMessage}
            />
            <button
              type="button"
              aria-label={t("Cancel reply")}
              onClick={() => {
                setReplyTarget(null);
                replyCache.delete(thread.id);
              }}
              className="ml-auto rounded-md p-1.5 text-neutral-400 hover:bg-foreground/10 hover:text-foreground"
            >
              <XIcon size={15} />
            </button>
          </div>
        ) : null}
        {attachmentError ? (
          <div
            role="alert"
            className="mb-2 flex items-center gap-2 rounded-xl border border-destructive/30 px-3 py-2 text-xs text-destructive"
          >
            <WarningCircleIcon weight="fill" className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{attachmentError}</span>
            <button
              type="button"
              aria-label={t("Dismiss")}
              onClick={() => setAttachmentError(null)}
              className="rounded-md p-1 hover:bg-foreground/10"
            >
              <XIcon size={13} />
            </button>
          </div>
        ) : null}
        <Composer
          className="mx-auto"
          value={input}
          onValueChange={(next) => {
            setInput(next);
            setThreadDraft(draftCache, thread.id, next);
          }}
          onSubmit={submit}
          onStop={stopTask}
          onError={setAttachmentError}
          status={status}
          globalDrop
          multiple
          placeholder={
            thread.kind === "group"
              ? t("Message {name} · @everyone", { name: thread.title })
              : t("Message {name}", { name: bot.name })
          }
          textareaProps={{
            ref: inputRef,
            title: t("Enter to send · Shift+Enter for a new line"),
            "aria-label": t("Message {name}", {
              name: thread.kind === "group" ? thread.title : bot.name,
            }),
            "aria-controls": mentionOptions.length ? `mentions-${thread.id}` : undefined,
            "aria-activedescendant": mentionOptions.length
              ? `mention-${thread.id}-${mentionIndex}`
              : undefined,
            onChange: (event) => {
              setMentionCursor(event.currentTarget.selectionStart);
              setMentionIndex(0);
            },
            onClick: (event) => {
              setMentionCursor(event.currentTarget.selectionStart);
              setMentionIndex(0);
            },
            onKeyDown: (event) => {
              if (!mentionOptions.length || event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setMentionIndex(
                  (value) =>
                    (value + (event.key === "ArrowDown" ? 1 : -1) + mentionOptions.length) %
                    mentionOptions.length,
                );
              } else if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                insertMention(
                  mentionOptions[Math.min(mentionIndex, mentionOptions.length - 1)].name,
                );
              } else if (event.key === "Escape") {
                event.preventDefault();
                setMentionCursor(-1);
              }
            },
          }}
          actionMenuItems={<ChatComposerActionMenu value={runMode} onChange={onRunModeChange} />}
          voiceInput={
            <ChatComposerVoiceInput
              value={input}
              onValueChange={(next) => {
                setInput(next);
                setThreadDraft(draftCache, thread.id, next);
              }}
            />
          }
          tools={<ChatComposerTools value={runMode} onChange={onRunModeChange} />}
        />
      </div>
    </section>
  );
}

/** Shown instead of a send error when the message needs a connected Deni AI account. */
function ConnectDeniAiAlert({ onDismiss }: { onDismiss: () => void }) {
  const t = useExtracted();
  const { busy, connect } = useConnectDeniAi();
  return (
    <Alert>
      <LinkSimpleIcon />
      <AlertTitle>{t("Connect your Deni AI account")}</AlertTitle>
      <AlertDescription>
        <p>
          {t("Deni Run uses the plan of your Deni AI account. Connect one to keep using teammates, the browser, and the computer.")}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <Button type="button" variant="primary" size="xs" loading={busy} onClick={() => void connect()}>
            {t("Connect Deni AI account")}
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={onDismiss}>
            {t("Dismiss")}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function ArtifactList({
  artifacts,
  onRevision,
}: {
  artifacts: Artifact[];
  onRevision: (artifact: Artifact) => void;
}) {
  const t = useExtracted();
  return (
    <div className="mt-4 space-y-2" aria-label={t("Artifacts")}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("Deliverables")}
      </p>
      {artifacts.slice(0, 12).map((artifact) => (
        <ArtifactCard
          key={artifact.id}
          artifact={artifact}
          onRevision={onRevision}
        />
      ))}
    </div>
  );
}

function ArtifactCard({
  artifact,
  onRevision,
}: {
  artifact: Artifact;
  onRevision: (artifact: Artifact) => void;
}) {
  const t = useExtracted();
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function showPreview() {
    if (preview != null) {
      setPreview(null);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `/api/artifacts/${artifact.id}?mode=preview`,
        { cache: "no-store" },
      );
      const json = (await response.json()) as { content?: string };
      setPreview(json.content ?? t("Unable to preview this file."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-lg bg-surface-raised p-3 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <FolderIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{artifact.title}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {artifact.path}
          </p>
          {artifact.description ? (
            <p className="mt-1 text-xs text-neutral-165">
              {artifact.description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          loading={busy}
          onClick={() => void showPreview()}
        >
          {preview == null ? t("Preview") : t("Hide preview")}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          icon={DownloadIcon}
          onClick={() => {
            window.location.href = `/api/artifacts/${artifact.id}?mode=download`;
          }}
        >
          {t("Download")}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => onRevision(artifact)}
        >
          {t("Request revision")}
        </Button>
      </div>
      {preview != null ? (
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-foreground/5 p-2 font-mono text-xs text-neutral-212">
          {preview}
        </pre>
      ) : null}
    </div>
  );
}

type WorkTimer = { start: number; end?: number };
const workTimers = new Map<string, WorkTimer>();
const workTimerListeners = new Set<() => void>();

function subscribeWorkTimers(listener: () => void) {
  workTimerListeners.add(listener);
  return () => {
    workTimerListeners.delete(listener);
  };
}

function setWorkTimer(key: string, rec: WorkTimer) {
  workTimers.set(key, rec);
  for (const listener of workTimerListeners) listener();
}

function useWorkedDuration(key: string, active: boolean) {
  useEffect(() => {
    const rec = workTimers.get(key);
    if (active) {
      if (!rec) setWorkTimer(key, { start: Date.now() });
      return () => {
        const current = workTimers.get(key);
        if (current && current.end == null)
          setWorkTimer(key, { ...current, end: Date.now() });
      };
    }
    if (rec && rec.end == null) setWorkTimer(key, { ...rec, end: Date.now() });
  }, [key, active]);

  const rec = useSyncExternalStore(
    subscribeWorkTimers,
    () => workTimers.get(key),
    () => workTimers.get(key),
  );
  if (!rec?.end) return null;
  return rec.end - rec.start;
}

function collectHandoffIds(messages: UIMessage[]) {
  const ids: string[] = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool")
        continue;
      const tool = part as ToolPart;
      const name = tool.toolName ?? part.type.replace(/^tool-/, "");
      if (name !== "messageBot") continue;
      const output =
        tool.output && typeof tool.output === "object"
          ? (tool.output as Record<string, unknown>)
          : null;
      if (typeof output?.handoffId === "string") ids.push(output.handoffId);
    }
  }
  return [...new Set(ids)];
}

function ContextResetDivider() {
  const t = useExtracted();
  return (
    <div role="separator" className="flex items-center gap-3 py-1 text-[11px] text-muted-foreground">
      <span className="h-px flex-1 bg-foreground/10" />
      <span className="flex items-center gap-1.5">
        <RotateCcwIcon size={11} />
        {t("New conversation · earlier messages are not sent")}
      </span>
      <span className="h-px flex-1 bg-foreground/10" />
    </div>
  );
}

function CompactionDivider() {
  const t = useExtracted();
  return (
    <div role="separator" className="flex items-center gap-3 py-1 text-[11px] text-muted-foreground">
      <span className="h-px flex-1 bg-foreground/10" />
      <span className="flex items-center gap-1.5">
        <ArchiveIcon size={11} />
        {t("Earlier messages were summarized to save tokens")}
      </span>
      <span className="h-px flex-1 bg-foreground/10" />
    </div>
  );
}

function EmptyState({ bot }: { bot: Bot }) {
  const t = useExtracted();
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: easeOut }}
    >
      <Empty
        icon={<RobotIcon size={48} className="text-neutral-109" />}
        title={bot.name}
        description={t("{job}. No workflow is required. Write as if you were asking a colleague. I will research on the computer, leave artifacts in files, and ask for approval only when needed.", { job: bot.job })}
      />
    </motion.div>
  );
}

const MessageBlock = memo(function MessageBlock({
  workKey,
  message,
  isLastMessage,
  isStreaming,
  onApprove,
  handoffs,
  bots,
  reactions,
  onReply,
  onReact,
  actionsDisabled,
  actionKey,
  bubbles,
  onLocate,
  author,
  showAuthor,
  authorIcon,
}: {
  workKey: string;
  message: UIMessage;
  isLastMessage: boolean;
  isStreaming: boolean;
  onApprove: (id: string, approved: boolean) => void;
  handoffs: Record<string, HandoffSnapshot>;
  bots: Bot[];
  reactions: ReactionMap;
  onReply: (reference: MessageReference) => void;
  onReact: (
    messageId: string,
    emoji: MessageReaction,
    selected: boolean,
  ) => Promise<void>;
  actionsDisabled: boolean;
  actionKey: string;
  bubbles: MessageBubble[];
  onLocate: (key: string) => void;
  author: MessageAuthor | null;
  showAuthor: boolean;
  authorIcon?: string | null;
}) {
  const t = useExtracted();
  const toolLabel = useToolDisplayLabel();
  const formatWorkedDuration = (ms: number) => {
    const seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 60) return t("Worked for {count}s", { count: String(seconds) });
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return t("Worked for {count}m", { count: String(minutes) });
    return t("Worked for {count}h", { count: String(Math.round(minutes / 60)) });
  };
  const cotSteps = groupRepeatedSteps(
    buildCotSteps(toolLabel, message.parts, handoffs, bots),
    message.parts,
  );
  const stepRuns = groupStepRuns(cotSteps, message.parts);
  const cotWorking = cotSteps.length > 0 && isLastMessage && isStreaming;
  // The saved duration covers the whole run and survives a reload; the local timer only fills in
  // until the finish metadata arrives.
  const liveWorkedMs = useWorkedDuration(workKey, cotWorking);
  const workedMs = workedMsOf(message) ?? liveWorkedMs;
  const replyTo = replyReference(message);
  const attachments = message.role === "user" ? messageAttachments(message) : [];
  const canAct =
    !actionsDisabled &&
    (message.role === "user" || message.role === "assistant");

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: easeOut }}
    >
      <Message
        from={message.role}
        data-message=""
        data-message-key={bubbles.length ? undefined : actionKey}
        tabIndex={-1}
        className="scroll-mt-4 rounded-xl outline-none"
      >
        {showAuthor && message.role === "assistant" ? (
          <div className="mb-1 flex items-center gap-2">
            <span className="[&>span]:size-6">
              <Avatar
                name={author?.name ?? t("Teammate")}
                accent={author?.accent ?? "#555555"}
                icon={authorIcon}
              />
            </span>
            <span className="text-xs font-semibold text-neutral-300">
              {author?.name ?? t("Teammate")}
            </span>
          </div>
        ) : null}
        <div
          className={
            message.role === "user"
              ? "flex max-w-[min(640px,90%)] flex-col items-end gap-1"
              : "flex min-w-0 w-full max-w-[min(640px,92%)] flex-col gap-1"
          }
        >
          {replyTo ? (
            <MessageReferenceCard
              reference={replyTo}
              botName={t("Teammate")}
              onLocate={onLocate}
            />
          ) : null}
          {attachments.length ? (
            <Attachments className="justify-end">
              {attachments.map((file) => (
                <Attachment
                  key={file.path}
                  data={file}
                  title={file.path}
                />
              ))}
            </Attachments>
          ) : null}
          {message.parts.map((part, index) => {
            const partBubbles = bubbles.filter(
              (bubble) => bubble.partIndex === index,
            );
            if (part.type === "text" && (partBubbles.length || usesBubbleBreaks(message.metadata))) {
              return partBubbles.map((bubble) => (
                <div
                  key={bubble.key}
                  data-message-key={bubble.key}
                  tabIndex={-1}
                  className={`group/message flex min-w-0 max-w-full scroll-mt-4 flex-col gap-1 rounded-xl outline-none ${message.role === "user" ? "items-end" : "items-start"}`}
                >
                  <MessageActions
                    side={message.role === "user" ? "end" : "start"}
                    text={bubble.text}
                    reactions={reactions[bubble.key] ?? []}
                    disabled={!canAct}
                    onReply={() =>
                      onReply({
                        key: bubble.key,
                        role: bubble.role,
                        text: bubble.text.slice(0, 4000),
                      })
                    }
                    onReact={(emoji, selected) =>
                      onReact(bubble.key, emoji, selected)
                    }
                  >
                    <MessageContent>
                      <MessageResponse
                        isAnimating={
                          isLastMessage &&
                          isStreaming &&
                          bubble.key === bubbles.at(-1)?.key
                        }
                      >
                        {bubble.text}
                      </MessageResponse>
                    </MessageContent>
                  </MessageActions>
                </div>
              ));
            }
            const run = stepRuns.find((item) => item[0].partIndex === index);
            return (
              <Fragment key={`${message.id}-${index}`}>
                {run ? <StepRun steps={run} /> : null}
                <PartView
                  part={part}
                  onApprove={onApprove}
                  isAnimating={isLastMessage && isStreaming}
                />
              </Fragment>
            );
          })}
          {cotSteps.length > 0 && !cotWorking && workedMs != null ? (
            <span className="px-1 text-xs text-muted-foreground">
              {formatWorkedDuration(workedMs)}
            </span>
          ) : null}
        </div>
      </Message>
    </motion.div>
  );
});

// Merged steps list this many details before the rest are folded away.
const STEP_DETAILS_SHOWN = 3;

/**
 * Steps with nothing shown between them, folded into one line. The teammate's own progress
 * lines say what it is doing; the steps stay one click away. A single step is shown as is.
 */
function StepRun({ steps }: { steps: CotStep[] }) {
  const t = useExtracted();
  const [expanded, setExpanded] = useState(false);
  if (steps.length === 1) return <StepLine step={steps[0]} />;
  const total = steps.reduce((sum, step) => sum + (step.count ?? 1), 0);
  const failed = steps.filter((step) => step.failed).length;
  const active = steps.findLast((step) => step.status === "active");
  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={`flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/40 ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        <ChevronRightIcon
          className={`size-3.5 shrink-0 transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate">
          {active ? (
            <>
              {active.label}
              <AnimatedDots />
            </>
          ) : (
            t("{count} actions", { count: String(total) })
          )}
        </span>
        {active ? (
          <span className="shrink-0 tabular-nums text-muted-foreground/70">
            {t("{count} actions", { count: String(total) })}
          </span>
        ) : null}
        {failed > 0 ? (
          <span className="shrink-0 text-destructive">
            {t("{count} failed", { count: String(failed) })}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className="ml-2.5 border-l border-foreground/10 pl-2">
          {steps.map((step) => (
            <StepLine key={step.key} step={step} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One tool step, shown in the timeline between the bubbles of a reply. */
function StepLine({ step }: { step: CotStep }) {
  const t = useExtracted();
  const [expanded, setExpanded] = useState(false);
  const Icon = step.icon;
  // Identical details, such as the same approval note on every call, are listed once.
  const details = (step.details ?? [step.description]).filter(
    (detail, index, all) =>
      detail != null && detail !== "" && (typeof detail !== "string" || all.indexOf(detail) === index),
  );
  const hidden = expanded ? 0 : Math.max(0, details.length - STEP_DETAILS_SHOWN);
  return (
    <div
      className={`flex min-w-0 gap-2 px-1 py-0.5 text-xs ${step.status === "active" ? "text-foreground" : "text-muted-foreground"} fade-in-0 animate-in`}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="break-words">
          {step.label}
          {step.count ? (
            <span className="ml-1.5 tabular-nums text-muted-foreground/70">×{step.count}</span>
          ) : null}
          {step.status === "active" ? <AnimatedDots /> : null}
        </div>
        {details.length === 1 ? (
          <div className="break-words text-muted-foreground">{details[0]}</div>
        ) : details.length > 1 ? (
          <ul className="space-y-1 text-muted-foreground">
            {details.slice(0, details.length - hidden).map((detail, index) => (
              <li key={index} className="break-words">
                {detail}
              </li>
            ))}
            {hidden > 0 || expanded ? (
              <li>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((value) => !value)}
                  className="rounded text-muted-foreground/80 underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-foreground/40"
                >
                  {expanded ? t("Show less") : t("Show {count} more", { count: String(hidden) })}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
        {step.sites && step.sites.length > 0 ? (
          <ChainOfThoughtSearchResults>
            {step.sites.map((site) =>
              site.href ? (
                <a
                  key={site.href}
                  href={site.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={site.title ?? site.href}
                  className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
                >
                  <ChainOfThoughtSearchResult className="cursor-pointer hover:bg-foreground/15">
                    {site.host}
                  </ChainOfThoughtSearchResult>
                </a>
              ) : (
                <ChainOfThoughtSearchResult key={site.host}>
                  {site.host}
                </ChainOfThoughtSearchResult>
              ),
            )}
          </ChainOfThoughtSearchResults>
        ) : null}
      </div>
    </div>
  );
}

/** Three bouncing dots in a reply bubble while the teammate is still working. */
function TypingIndicator() {
  const t = useExtracted();
  return (
    <motion.div
      role="status"
      aria-label={t("Working")}
      className="typing-dots flex w-fit items-center gap-1 rounded-2xl bg-surface-37 px-3.5 py-3"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: easeOut }}
    >
      <span />
      <span />
      <span />
    </motion.div>
  );
}

function MessageReferenceCard({
  reference,
  botName,
  onLocate,
}: {
  reference: MessageReference;
  botName: string;
  onLocate: (key: string) => void;
}) {
  const t = useExtracted();
  return (
    <button
      type="button"
      onClick={() => onLocate(reference.key)}
      aria-label={t("Go to referenced message")}
      className="flex min-w-0 max-w-full items-start gap-2 rounded-lg border-l-2 border-focus-muted bg-foreground/5 px-3 py-2 text-left hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-foreground/40"
    >
      <CornerUpLeftIcon
        size={14}
        className="mt-0.5 shrink-0 text-neutral-400"
      />
      <span className="min-w-0">
        <span className="block text-[11px] font-medium text-neutral-300">
          {reference.role === "user" ? t("Replying to you") : t("Replying to {name}", { name: botName })}
        </span>
        <span className="block max-w-full truncate text-xs text-neutral-400">
          {reference.text.slice(0, 180) || t("Message")}
        </span>
      </span>
    </button>
  );
}

type ToolPart = {
  type: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  error?: unknown;
  rawInput?: unknown;
  approval?: { id: string; approved?: boolean; isAutomatic?: boolean };
};

type CotStep = {
  key: string;
  partIndex: number;
  icon: LucideIcon;
  label: string;
  description?: ReactNode;
  sites?: StepSite[];
  status: "complete" | "active" | "pending";
  failed?: boolean;
  /** Repeated steps merged into this one: how many, each one's description, and the last part. */
  count?: number;
  details?: ReactNode[];
  lastPartIndex?: number;
};

/** Parts that render nothing, so steps on either side of them read as one run. */
function isSilentPart(part: UIMessage["parts"][number]) {
  return part.type === "step-start" || part.type === "reasoning" || (part.type === "text" && !part.text.trim());
}

/** Splits steps into runs with nothing shown between them, each folded into one line. */
function groupStepRuns(steps: CotStep[], parts: UIMessage["parts"]): CotStep[][] {
  const runs: CotStep[][] = [];
  for (const step of steps) {
    const run = runs.at(-1);
    const previous = run?.at(-1);
    if (
      run &&
      previous &&
      parts.slice((previous.lastPartIndex ?? previous.partIndex) + 1, step.partIndex).every(isSilentPart)
    ) {
      run.push(step);
    } else {
      runs.push([step]);
    }
  }
  return runs;
}

/**
 * Merges finished steps that repeat the same action back to back, such as sending several
 * emails, into one line with a count and each one's details.
 */
function groupRepeatedSteps(steps: CotStep[], parts: UIMessage["parts"]): CotStep[] {
  const grouped: CotStep[] = [];
  for (const step of steps) {
    const previous = grouped.at(-1);
    const repeats =
      previous !== undefined &&
      previous.label === step.label &&
      previous.icon === step.icon &&
      previous.status === "complete" &&
      step.status === "complete" &&
      !previous.failed &&
      !step.failed &&
      parts.slice((previous.lastPartIndex ?? previous.partIndex) + 1, step.partIndex).every(isSilentPart);
    if (!previous || !repeats) {
      grouped.push(step);
      continue;
    }
    const sites = [...(previous.sites ?? []), ...(step.sites ?? [])];
    grouped[grouped.length - 1] = {
      ...previous,
      count: (previous.count ?? 1) + 1,
      details: [...(previous.details ?? [previous.description]), step.description],
      lastPartIndex: step.partIndex,
      sites: sites.filter(
        (site, index) => sites.findIndex((item) => item.host === site.host && item.href === site.href) === index,
      ),
    };
  }
  return grouped;
}

/** Tool steps of a reply, each placed after the text that came before it. Reasoning is not shown. */
function buildCotSteps(
  toolLabel: ReturnType<typeof useToolDisplayLabel>,
  parts: UIMessage["parts"],
  handoffs?: Record<string, HandoffSnapshot>,
  bots?: Bot[],
): CotStep[] {
  const steps: CotStep[] = [];

  parts.forEach((part, index) => {
    if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") return;
    const toolPart = part as ToolPart;
    const name =
      toolPart.toolName ??
      part.type.replace(/^tool-/, "").replace(/^dynamic-/, "");
    const state = toolPart.state ?? "";
    const input = toolPart.input ?? toolPart.rawInput;
    const errorText =
      toolPart.errorText ??
      (toolPart.error != null ? formatDetail(toolPart.error) : "");
    const failed = state === "output-error";

    if (name === "requestTakeover") return;
    if (name === "handoffStatus") return;
    // Approvals stay as their card, before and after they are answered.
    if (toolPart.approval && !toolPart.approval.isAutomatic) return;

    const liveHandoff =
      name === "messageBot" ? liveHandoffFor(toolPart, handoffs) : undefined;
    steps.push({
      key: toolPart.toolCallId ?? `tool-${index}`,
      partIndex: index,
      icon: toolStepIcon(name),
      label: toolLabel(name, input, state, liveHandoff, bots),
      description:
        failed && errorText
          ? errorText
          : liveHandoff?.status === "running" && liveHandoff.currentLabel
            ? liveHandoff.currentLabel
            : name === "mcp"
              ? mcpStepDetail(input)
              : undefined,
      sites: failed ? undefined : stepSites(name, toolPart.output, input),
      failed,
      status:
        liveHandoff?.status === "running" || isToolRunning(state)
          ? "active"
          : state
            ? "complete"
            : "pending",
    });
  });

  return steps;
}

function liveHandoffFor(
  toolPart: ToolPart,
  handoffs?: Record<string, HandoffSnapshot>,
) {
  const output =
    toolPart.output && typeof toolPart.output === "object"
      ? (toolPart.output as Record<string, unknown>)
      : null;
  const id = typeof output?.handoffId === "string" ? output.handoffId : "";
  return id ? handoffs?.[id] : undefined;
}

function toolStepIcon(name: string): LucideIcon {
  if (name === "browser" || name.toLowerCase().includes("browser"))
    return GlobeIcon;
  switch (name) {
    case "workspace":
      return FolderIcon;
    case "runCommand":
    case "stopSandbox":
      return TerminalIcon;
    case "webSearch":
      return SearchIcon;
    case "mcp":
    case "listMcpConnections":
    case "listBuiltinPlugins":
    case "builtInPlugin":
      return WrenchIcon;
    case "remember":
      return BookOpenIcon;
    case "conversationHistory":
      return HistoryIcon;
    case "saveSkill":
    case "listSkills":
    case "readSkill":
      return SparklesIcon;
    case "scheduleRoutine":
    case "listRoutines":
    case "pauseRoutine":
      return ClockIcon;
    case "messageBot":
    case "handoffStatus":
      return SendIcon;
    default:
      return WrenchIcon;
  }
}

type StepSite = { host: string; href?: string; title?: string };

function stepSites(
  name: string,
  output: unknown,
  input: unknown,
): StepSite[] | undefined {
  if (name === "webSearch") return webSearchResultSites(output);
  if (name === "browser" || name.toLowerCase().includes("browser")) {
    const hostname = browserResultHostname(output, input);
    return hostname ? [{ host: hostname }] : undefined;
  }
  return undefined;
}

function webSearchResultSites(output: unknown): StepSite[] | undefined {
  if (!output || typeof output !== "object") return undefined;
  const results = (output as Record<string, unknown>).results;
  if (!Array.isArray(results)) return undefined;
  const sites: StepSite[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.url !== "string") continue;
    let href: string;
    let host: string;
    try {
      const parsed = new URL(entry.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      href = parsed.toString();
      host = parsed.hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (seen.has(href)) continue;
    seen.add(href);
    sites.push({
      host,
      href,
      ...(typeof entry.title === "string" && entry.title
        ? { title: entry.title }
        : {}),
    });
  }
  return sites.length > 0 ? sites : undefined;
}

function browserResultHostname(output: unknown, input: unknown) {
  const url =
    output &&
    typeof output === "object" &&
    typeof (output as Record<string, unknown>).url === "string"
      ? ((output as Record<string, unknown>).url as string)
      : inputValue(input, "url");
  if (!url) return undefined;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
  } catch {
    return undefined;
  }
}

function PartView({
  part,
  onApprove,
  isAnimating = false,
}: {
  part: UIMessage["parts"][number];
  onApprove: (id: string, approved: boolean) => void;
  isAnimating?: boolean;
}) {
  const t = useExtracted();
  const toolLabel = useToolDisplayLabel();
  const pluginActionLabels = usePluginActionLabels();
  if (part.type === "text" && part.text.trim()) {
    return (
      <MessageContent>
        <MessageResponse isAnimating={isAnimating}>{part.text}</MessageResponse>
      </MessageContent>
    );
  }

  if (part.type === "reasoning") return null;

  if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
    const toolPart = part as ToolPart;
    const name =
      toolPart.toolName ??
      part.type.replace(/^tool-/, "").replace(/^dynamic-/, "");
    const state = toolPart.state ?? "";
    const input = toolPart.input ?? toolPart.rawInput;
    const errorText =
      toolPart.errorText ??
      (toolPart.error != null ? formatDetail(toolPart.error) : "");
    if (toolPart.approval && !toolPart.approval.isAutomatic) {
      const approval = toolPart.approval;
      const detail = toolApprovalDetail(name, input, pluginActionLabels);
      const answered = state !== "approval-requested";
      // Once answered, the same card stays with the answer in place of the buttons.
      return (
        <Confirmation approval={approval} state={state}>
          {name === "mcp" ? (
            <McpApprovalDetails
              connectionId={inputValue(input, "connectionId")}
              tool={inputValue(input, "name")}
              args={inputRecord(input, "arguments") as Record<string, unknown> | undefined}
              toolCallId={toolPart.toolCallId}
              explain={!answered}
            />
          ) : (
            // The title it had while waiting, so the answered card reads the same.
            <ConfirmationTitle>{toolLabel(name, input, "approval-requested")}</ConfirmationTitle>
          )}
          {detail && name !== "mcp" ? (
            <p className="font-mono text-xs text-secondary-foreground">{detail}</p>
          ) : null}
          {name === "builtInPlugin" && inputValue(input, "body") ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-foreground/5 p-2 text-xs">{inputValue(input, "body")}</pre> : null}
          <ApprovalActions
            onApprove={() => onApprove(approval.id, true)}
            onDeny={() => onApprove(approval.id, false)}
            onAlwaysAllow={name === "builtInPlugin" ? async () => {
              const response = await fetch("/api/plugins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: inputValue(input, "kind"), action: inputValue(input, "action"), enabled: true }) });
              if (!response.ok) throw new Error((await response.json()).error ?? t("Could not save permission."));
              onApprove(approval.id, true);
            } : name === "mcp" && inputValue(input, "name") ? async () => {
              const response = await fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "always-allow", id: inputValue(input, "connectionId"), tool: inputValue(input, "name"), enabled: true }) });
              if (!response.ok) throw new Error((await response.json()).error ?? t("Could not save permission."));
              onApprove(approval.id, true);
            } : undefined}
          />
          <ConfirmationAccepted>
            <p className="flex items-center gap-1.5 self-end text-xs text-muted-foreground">
              <CheckIcon className="size-3.5" aria-hidden="true" />
              {t("Approved")}
            </p>
          </ConfirmationAccepted>
          <ConfirmationRejected>
            <p className="flex items-center gap-1.5 self-end text-xs text-muted-foreground">
              <XIcon className="size-3.5" aria-hidden="true" />
              {t("Declined")}
            </p>
          </ConfirmationRejected>
          {state === "output-error" && errorText ? (
            <p className="text-xs text-destructive-300">{errorText}</p>
          ) : null}
        </Confirmation>
      );
    }
    if (name === "messageBot" || name === "handoffStatus") return null;
    if (name === "listBuiltinPlugins" && state === "output-available" && Array.isArray(toolPart.output)) {
      const plugins = toolPart.output as { kind: string; connected: boolean }[];
      return <div className="grid gap-2 sm:grid-cols-3">{plugins.map((plugin) => <button type="button" key={plugin.kind} onClick={() => window.dispatchEvent(new Event("open-plugins"))} className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-left transition-colors hover:bg-primary/10"><span className="block font-medium">{plugin.kind === "drive" ? "Google Drive" : plugin.kind === "gmail" ? "Gmail" : "GitHub"}</span><span className="text-xs text-muted-foreground">{plugin.connected ? t("Connected · manage") : t("Connect")}</span></button>)}</div>;
    }
    if (name === "requestTakeover") {
      const reason = inputValue(input, "reason");
      const failed = state === "output-error";
      return (
        <Alert variant={failed ? "destructive" : "warning"}>
          <WarningCircleIcon weight="fill" />
          <AlertTitle>
            {failed ? t("Couldn't request your help") : t("Requested your help")}
          </AlertTitle>
          <AlertDescription>
            {failed
              ? errorText || t("The computer could not be handed over.")
              : `${reason ? `${reason} ` : ""}${t("Take control of the computer to continue.")}`}
          </AlertDescription>
        </Alert>
      );
    }

    return null;
  }

  return null;
}

function formatDetail(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function useToolDisplayLabel() {
  const t = useExtracted();
  const mcpName = useMcpConnectionNames();

  function toolDisplayLabel(
  name: string,
  input: unknown,
  state: string,
  liveHandoff?: HandoffSnapshot,
  bots?: Bot[],
) {
  const completed = state === "output-available";
  const failed = state === "output-error";
  const denied = state === "output-denied";
  const action = inputValue(input, "action");

  if (name === "messageBot") {
    const botId = inputValue(input, "botId");
    const teammate =
      liveHandoff?.targetName ||
      bots?.find((item) => item.id === botId)?.name ||
      t("a teammate");
    if (failed || liveHandoff?.status === "error")
      return t("Couldn't reach {teammate}", { teammate });
    if (liveHandoff?.status === "running") return t("{teammate} is working", { teammate });
    return completed ? t("Asked {teammate}", { teammate }) : t("Asking {teammate}", { teammate });
  }

  if (denied) return t("Action was declined");

  if (name === "mcp") {
    const service = mcpName(inputValue(input, "connectionId")) ?? t("a connected app");
    if (action === "list") {
      if (failed) return t("Couldn't check {service} tools", { service });
      return completed ? t("Checked {service} tools", { service }) : t("Checking {service} tools", { service });
    }
    // The tool name and its arguments go in the step's detail line (mcpStepDetail).
    const kind = mcpToolKind(inputValue(input, "name") ?? "");
    if (kind === "read") {
      if (failed) return t("Couldn't check {service}", { service });
      return completed ? t("Checked {service}", { service }) : t("Checking {service}", { service });
    }
    if (kind === "write") {
      if (failed) return t("Couldn't update {service}", { service });
      return completed ? t("Updated {service}", { service }) : t("Updating {service}", { service });
    }
    if (failed) return t("Couldn't use {service}", { service });
    return completed ? t("Used {service}", { service }) : t("Using {service}", { service });
  }

  if (name === "browser" || name.toLowerCase().includes("browser")) {
    switch (action) {
      case "navigate":
        if (failed) return t("Couldn't open the page");
        return completed ? t("Opened page") : t("Opening page");
      case "snapshot":
        if (failed) return t("Couldn't read the page");
        return completed ? t("Read the page") : t("Reading the page");
      case "click":
        if (failed) return t("Couldn't click the page");
        return completed ? t("Clicked the page") : t("Clicking the page");
      case "type":
        if (failed) return t("Couldn't enter the text");
        return completed ? t("Entered text") : t("Entering text");
      case "press": {
        const key = inputValue(input, "key") ?? t("a key");
        if (failed) return t("Couldn't press {key}", { key });
        return completed ? t("Pressed {key}", { key }) : t("Pressing {key}", { key });
      }
      case "scroll": {
        const dy = inputNumber(input, "dy");
        const up = dy != null && dy < 0;
        if (failed) return t("Couldn't scroll the page");
        if (completed) return up ? t("Scrolled up") : t("Scrolled down");
        return up ? t("Scrolling up") : t("Scrolling down");
      }
      default:
        return failed
          ? t("Couldn't use the browser")
          : completed
            ? t("Used the browser")
            : t("Using the browser");
    }
  }

  const labels: Record<string, [present: string, past: string, failed: string]> = {
    workspace: [t("Updating files"), t("Updated files"), t("Couldn't update files")],
    runCommand: [t("Running a command"), t("Ran a command"), t("Couldn't run a command")],
    stopSandbox: [t("Stopping the computer"), t("Stopped the computer"), t("Couldn't stop the computer")],
    webSearch: [t("Searching the web"), t("Searched the web"), t("Couldn't search the web")],
    remember: [t("Saving a memory"), t("Saved a memory"), t("Couldn't save a memory")],
    conversationHistory: [t("Looking back at the conversation"), t("Looked back at the conversation"), t("Couldn't look back at the conversation")],
    saveSkill: [t("Saving a skill"), t("Saved a skill"), t("Couldn't save a skill")],
    listSkills: [t("Checking saved skills"), t("Checked saved skills"), t("Couldn't check saved skills")],
    readSkill: [t("Reading a skill"), t("Read a skill"), t("Couldn't read a skill")],
    scheduleRoutine: [t("Scheduling a routine"), t("Scheduled a routine"), t("Couldn't schedule a routine")],
    listRoutines: [t("Checking routines"), t("Checked routines"), t("Couldn't check routines")],
    listBuiltinPlugins: [t("Showing connected services"), t("Showed connected services"), t("Couldn't show connected services")],
    builtInPlugin: [t("Using a connected service"), t("Used a connected service"), t("Couldn't use a connected service")],
    listMcpConnections: [t("Checking connected apps"), t("Checked connected apps"), t("Couldn't check connected apps")],
    pauseRoutine: [t("Updating a routine"), t("Updated a routine"), t("Couldn't update a routine")],
    messageBot: [t("Asking a teammate"), t("Asked a teammate"), t("Couldn't ask a teammate")],
    handoffStatus: [t("Checking a teammate"), t("Checked a teammate"), t("Couldn't check a teammate")],
    requestTakeover: [t("Waiting for your help"), t("Requested your help"), t("Couldn't request your help")],
  };
  const tool = humanizeToolName(name);
  const [present, past, couldNot] = labels[name] ?? [
    t("Working on {tool}", { tool }),
    t("Finished {tool}", { tool }),
    t("Couldn't finish {tool}", { tool }),
  ];
  if (failed) return couldNot;
  return completed ? past : present;
  }

  return toolDisplayLabel;
}

function toolApprovalDetail(name: string, input: unknown, pluginActionLabels: Record<string, string>) {
  if (name === "runCommand") return snippet(inputValue(input, "command"));
  if (name === "builtInPlugin") {
    const action = inputValue(input, "action");
    return snippet([inputValue(input, "kind"), action ? pluginActionLabels[action] ?? action : undefined, inputValue(input, "repo"), inputValue(input, "to"), inputValue(input, "subject"), inputValue(input, "title"), inputValue(input, "id"), inputValue(input, "state"), inputValue(input, "event"), inputValue(input, "mergeMethod")].filter(Boolean).join(" · "), 220);
  }
  if (name === "workspace") {
    const path = inputValue(input, "path");
    return path ? snippet(path) : undefined;
  }
  if (name === "mcp") return snippet(mcpArgumentPreview(inputRecord(input, "arguments")).summary, 220);
  return undefined;
}

/** What an MCP call worked on, such as "Path: /v1/customers", or else the tool's own name. */
function mcpStepDetail(input: unknown) {
  return snippet(mcpArgumentPreview(inputRecord(input, "arguments")).summary, 160) ?? (mcpToolTitle(inputValue(input, "name") ?? "") || undefined);
}

function snippet(value?: string, max = 72) {
  if (!value) return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function ApprovalActions({
  onApprove,
  onDeny,
  onAlwaysAllow,
}: {
  onApprove: () => void;
  onDeny: () => void;
  onAlwaysAllow?: () => Promise<void>;
}) {
  const t = useExtracted();
  const [busy, setBusy] = useState<"approve" | "deny" | "always" | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  return (
    <ConfirmationActions>
      <ConfirmationAction
        variant="primary"
        loading={busy === "approve"}
        disabled={busy !== null}
        onClick={() => {
          setBusy("approve");
          onApprove();
        }}
      >
        {t("Approve")}
      </ConfirmationAction>
      {onAlwaysAllow ? <ConfirmationAction variant="outline" loading={busy === "always"} disabled={busy !== null} onClick={() => {
        setBusy("always");
        void onAlwaysAllow().catch((error) => { setPermissionError(error instanceof Error ? error.message : t("Could not save permission.")); setBusy(null); });
      }}>{t("Always allow")}</ConfirmationAction> : null}
      {permissionError ? <span role="alert" className="text-xs text-destructive-300">{permissionError}</span> : null}
      <ConfirmationAction
        variant="outline"
        loading={busy === "deny"}
        disabled={busy !== null}
        onClick={() => {
          setBusy("deny");
          onDeny();
        }}
      >
        {t("Deny")}
      </ConfirmationAction>
    </ConfirmationActions>
  );
}

function inputValue(input: unknown, key: string) {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function inputRecord(input: unknown, key: string) {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function inputNumber(input: unknown, key: string) {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function humanizeToolName(name: string) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase();
}

function isToolRunning(state: string) {
  return (
    state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-responded"
  );
}

function AnimatedDots() {
  const t = useExtracted();
  return (
    <span aria-label={t("in progress")} className="animated-dots ml-1" role="img">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}
