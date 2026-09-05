"use client";

import { useChat } from "@ai-sdk/react";
import {
  type UIMessage,
} from "ai";
import {
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
import { RobotIcon, StopIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
  BookOpenIcon,
  BrainIcon,
  ClockIcon,
  DownloadIcon,
  FolderIcon,
  GlobeIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  TerminalIcon,
  RotateCcwIcon,
  WrenchIcon,
  CornerUpLeftIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@/components/ai-elements/prompt-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Avatar } from "./sidebar";
import { MessageActions } from "./message-actions";
import { messageActionKey, messageBubbleTargets, replyReference, type MessageBubble, type MessageReference, type MessageReaction } from "@/lib/message-actions";
import { createReactionState, type ReactionMap } from "@/lib/reaction-state";
import { RUN_MODES, type RunMode } from "@/lib/model";
import type { AgentJob, Artifact, Bot, HandoffSnapshot, Thread } from "@/lib/types";
import { isActiveJob, latestJob, mergeJobSnapshots } from "@/lib/job-view";
import { clearThreadDraft, getThreadDraft, setThreadDraft } from "@/lib/thread-state";
import type { Chat } from "@ai-sdk/react";
import {
  getChatSessionRunStatus,
  setChatSessionRunStatus,
  subscribeChatSessionRunStatus,
} from "@/lib/chat-sessions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const draftCache = new Map<string, string>();
const scrollCache = new Map<string, number>();
const replyCache = new Map<string, MessageReference>();
const reactionStates = new Map<string, ReturnType<typeof createReactionState>>();

function getReactionState(threadId: string, initial: ReactionMap = {}) {
  const existing = reactionStates.get(threadId);
  if (existing) return existing;
  const state = createReactionState(async (messageId, emoji, selected) => {
    const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/reactions`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, emoji, selected }),
    });
    if (!response.ok) throw new Error("Reaction could not be saved");
    return (await response.json() as { reactions: ReactionMap }).reactions;
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
  while (scrollCache.size > 100) scrollCache.delete(scrollCache.keys().next().value as string);
}

export function ChatThread({
  thread,
  bot,
  bots,
  runMode,
  onRunModeChange,
  onBusyChange,
  onActiveJobChange,
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
  backgroundJobs?: AgentJob[];
  onJobsChange?: (jobs: AgentJob[]) => void;
  chat: Chat<UIMessage>;
}) {
  const conversationContextRef = useRef<StickToBottomContext | null>(null);
  const { messages, sendMessage, status, addToolApprovalResponse, setMessages, stop, error, clearError } = useChat({ chat });

  const [input, setInput] = useState(() => getThreadDraft(draftCache, thread.id));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [replyTarget, setReplyTarget] = useState<MessageReference | null>(() => replyCache.get(thread.id) ?? null);
  const reactionState = useMemo(() => getReactionState(thread.id, thread.reactions), [thread.id, thread.reactions]);
  const reactions = useSyncExternalStore(reactionState.subscribe, reactionState.getSnapshot, reactionState.getSnapshot);
  const [handoffs, setHandoffs] = useState<Record<string, HandoffSnapshot>>({});
  const [jobs, setJobs] = useState<AgentJob[]>(backgroundJobs ?? []);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const syncedCompletion = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const taskRefreshSequence = useRef(0);
  const jobsChangeRef = useRef(onJobsChange);
  const displayedJobs = backgroundJobs ?? jobs;
  const usesSharedJobs = backgroundJobs !== undefined;
  const sharedJobSignal = backgroundJobs?.map((job) => `${job.id}:${job.status}:${job.attempt}`).join("|");
  const displayedJobsRef = useRef(displayedJobs);

  useEffect(() => {
    const controller = new AbortController();
    const revision = reactionState.getRevision();
    void fetch(`/api/threads/${encodeURIComponent(thread.id)}/reactions`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json() as { reactions: Record<string, string[]> };
        if (!controller.signal.aborted) reactionState.hydrate(data.reactions, revision);
      }).catch(() => undefined);
    return () => controller.abort();
  }, [thread.id, reactionState]);

  const replyToMessage = useCallback((reference: MessageReference) => {
    setReplyTarget(reference);
    replyCache.delete(thread.id);
    replyCache.set(thread.id, reference);
    while (replyCache.size > 100) replyCache.delete(replyCache.keys().next().value as string);
    requestAnimationFrame(() => {
      const textarea = inputRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }, [thread.id]);

  const reactToMessage = useCallback((messageId: string, emoji: MessageReaction, selected: boolean) => reactionState.toggle(messageId, emoji, selected), [reactionState]);

  const locateMessage = useCallback((key: string) => {
    const element = conversationContextRef.current?.scrollRef.current?.querySelector<HTMLElement>(`[data-message-key="${CSS.escape(key)}"]`);
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "center" });
    element.focus({ preventScroll: true });
    if (!reduced) element.animate([{ backgroundColor: "#ffffff18" }, { backgroundColor: "transparent" }], { duration: 1100 });
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
      setChatSessionRunStatus(thread.id, "working");
      const active = displayedJobs.find((item) => item.status === "waiting_approval");
      if (active) {
        await fetch(`/api/jobs/${active.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resume" }),
        });
      }
      addToolApprovalResponse({ id, approved });
    },
    [addToolApprovalResponse, displayedJobs, thread.id],
  );

  const busy = status === "submitted" || status === "streaming";
  const subscribeRunStatus = useCallback(
    (listener: () => void) => subscribeChatSessionRunStatus(thread.id, listener),
    [thread.id],
  );
  const chatRunStatus = useSyncExternalStore(
    subscribeRunStatus,
    () => getChatSessionRunStatus(thread.id),
    () => "idle",
  );
  const activeJob = latestJob(displayedJobs.filter(isActiveJob));
  const savingResult = activeJob?.status === "finalizing" || chatRunStatus === "finalizing";
  const waitingForUser = chatRunStatus === "waiting";
  const showBusyIndicator = busy && chatRunStatus !== "completed" && chatRunStatus !== "failed";

  const refreshTaskData = useCallback(async (signal?: AbortSignal, forceJobs = false) => {
    const sequence = ++taskRefreshSequence.current;
    const [jobsResponse, artifactsResponse] = await Promise.all([
      !usesSharedJobs || forceJobs ? fetch(`/api/jobs?threadId=${encodeURIComponent(thread.id)}`, { cache: "no-store", signal }) : Promise.resolve(null),
      fetch(`/api/artifacts?threadId=${encodeURIComponent(thread.id)}`, { cache: "no-store", signal }),
    ]);
    if (!mountedRef.current || sequence !== taskRefreshSequence.current) return;
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
      if (!busy && !active && current?.status === "completed" && syncedCompletion.current !== current.id) {
        syncedCompletion.current = current.id;
        void fetch(`/api/threads/${thread.id}`, { cache: "no-store", signal })
          .then((response) => { if (!response.ok) throw new Error("Could not load completed messages"); return response.json(); })
          .then((json) => {
            if (mountedRef.current && !signal?.aborted && chat.status !== "streaming" && chat.status !== "submitted" && !displayedJobsRef.current.some(isActiveJob)) setMessages(json.messages ?? []);
          })
          .catch(() => { if (syncedCompletion.current === current.id) syncedCompletion.current = null; });
      }
    if (artifactsResponse.ok) {
      const json = (await artifactsResponse.json()) as { artifacts?: Artifact[] };
      setArtifacts(json.artifacts ?? []);
    }
  }, [busy, chat, onActiveJobChange, setMessages, thread.id, usesSharedJobs]);

  useEffect(() => {
    // Polling rehydrates durable jobs after a disconnected chat request.
    const controller = new AbortController();
    let inFlight = true;
    // eslint-disable-next-line react/set-state-in-effect
    void refreshTaskData(controller.signal).catch(() => undefined).finally(() => { inFlight = false; });
    const timer = usesSharedJobs ? undefined : setInterval(() => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      void refreshTaskData(controller.signal).catch(() => undefined).finally(() => { inFlight = false; });
    }, 5_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refreshTaskData, sharedJobSignal, usesSharedJobs]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const stopTask = useCallback(() => {
    stop();
    for (const job of displayedJobs.filter((item) => ["queued", "running", "waiting_approval", "waiting_takeover"].includes(item.status))) {
      void fetch(`/api/jobs/${job.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      }).then(() => refreshTaskData());
    }
  }, [displayedJobs, refreshTaskData, stop]);

  const requestRevision = useCallback((artifact: Artifact) => {
    const next = `Revise the artifact "${artifact.title}" at ${artifact.path} and register the updated file.`;
    setInput(next);
    draftCache.set(thread.id, next);
  }, [thread.id]);

  useEffect(() => {
    const ids = collectHandoffIds(messages);
    if (ids.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = async () => {
      const res = await fetch("/api/handoffs");
      const json = (await res.json()) as { handoffs?: HandoffSnapshot[] };
      if (cancelled) return;
      const byId = new Map((json.handoffs ?? []).map((item) => [item.id, item]));
      const next: Record<string, HandoffSnapshot> = {};
      for (const id of ids) {
        const item = byId.get(id);
        if (item) next[id] = item;
      }
      setHandoffs(next);
      if (timer && Object.values(next).every((item) => item.status !== "running")) {
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

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setChatSessionRunStatus(thread.id, "working");
    setInput("");
    clearThreadDraft(draftCache, thread.id);
    sendMessage({ text, ...(replyTarget ? { metadata: { replyTo: replyTarget } } : {}) });
    setReplyTarget(null);
    replyCache.delete(thread.id);
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#050505] text-[#f0f0f0]">
      <motion.header
        className="hidden h-[54px] shrink-0 items-center gap-2.5 border-b border-white/10 bg-[#080808] px-4 md:flex"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: easeOut }}
      >
        <Avatar name={bot.name} accent={bot.accent} />
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="min-w-0 truncate text-[0.925rem] font-semibold text-[#f0f0f0]">
            {thread.kind === "group" ? thread.title : bot.name}
          </span>
          <span className="hidden min-w-0 truncate text-xs text-[#777777] 2xl:inline">
            {thread.kind === "group"
              ? bots
                  .filter((item) => thread.botIds.includes(item.id))
                  .map((item) => item.name)
                  .join(" · ")
              : bot.job}
          </span>
        </div>
        {showBusyIndicator && !savingResult && !waitingForUser ? (
          <Button
            type="button"
            variant="secondary-destructive"
            size="xs"
            icon={StopIcon}
             onClick={stopTask}
          >
            Stop
          </Button>
        ) : showBusyIndicator && savingResult ? (
          <span className="text-xs tracking-tighter text-[#8f8f8f]">Saving result…</span>
        ) : showBusyIndicator && waitingForUser ? (
          <span className="text-xs tracking-tighter text-amber-300">Waiting for your help…</span>
        ) : (
          <span className="text-xs tracking-tighter text-[#8f8f8f]">{RUN_MODES[runMode].hint}</span>
        )}
      </motion.header>

      <Conversation
        contextRef={conversationContextRef}
        className="min-h-0 flex-1"
        onScroll={(event) => rememberScroll(thread.id, event.currentTarget.scrollTop)}
      >
        <ConversationContent className="max-w-none gap-5 px-4 py-6 md:px-4 lg:px-5">
          {displayedJobs.length > 0 ? <JobStatusList jobs={displayedJobs} onRefresh={() => refreshTaskData(undefined, true)} /> : null}
          {messages.length === 0 ? (
            <ConversationEmptyState>
              <EmptyState bot={bot} />
            </ConversationEmptyState>
          ) : (
            messages.map((message, index) => (
              <MessageBlock
                key={message.id || `message-${index}`}
                workKey={`${thread.id}:${index}`}
                message={message}
                isLastMessage={index === messages.length - 1}
                isStreaming={showBusyIndicator && !savingResult && !waitingForUser}
                onApprove={onApprove}
                handoffs={handoffs}
                bots={bots}
                actionKey={messageActionKey(message, index)}
                bubbles={messageBubbleTargets(message, index)}
                onLocate={locateMessage}
                reactions={reactions}
                onReply={replyToMessage}
                onReact={reactToMessage}
                actionsDisabled={busy && index === messages.length - 1}
              />
            ))
          )}
          {showBusyIndicator ? (
            <span className="text-xs text-[#8f8f8f]">
              {waitingForUser ? "Waiting for your help" : savingResult ? "Saving result" : "Working on the computer"}
              <AnimatedDots />
            </span>
          ) : null}
          {artifacts.length > 0 ? (
            <ArtifactList artifacts={artifacts} onRevision={requestRevision} />
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <WarningCircleIcon weight="fill" />
              <AlertTitle>Failed to send</AlertTitle>
              <AlertDescription>
                <p>{error.message}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => clearError()}
                  className="-ml-2"
                >
                  Dismiss
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </ConversationContent>
      </Conversation>

      <div className="shrink-0 bg-[#050505] px-3 pb-4 pt-2 md:px-4">
        {replyTarget ? <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-[#202020] px-3 py-2">
          <MessageReferenceCard reference={replyTarget} botName={bot.name} onLocate={locateMessage} />
          <button type="button" aria-label="Cancel reply" onClick={() => { setReplyTarget(null); replyCache.delete(thread.id); }} className="ml-auto rounded-md p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white"><XIcon size={15} /></button>
        </div> : null}
        <PromptInput
          className="mx-auto w-full flex-row items-end gap-1 rounded-3xl border border-white/15 bg-[#2b2b2b] p-1.5 shadow-[0_2px_12px_#0003] focus-within:border-white/30"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="shrink-0 pb-1.5 pl-1"><RunModePicker value={runMode} onChange={onRunModeChange} /></div>
          <PromptInputTextarea
            ref={inputRef}
            className="min-h-9 min-w-0 flex-1 rounded-2xl border-0 bg-transparent px-2 py-2 focus-visible:border-transparent"
            title="Enter to send · Shift+Enter for a new line"
            value={input}
            onChange={(e) => {
              const next = e.currentTarget.value;
              setInput(next);
              setThreadDraft(draftCache, thread.id, next);
            }}
            onSubmit={submit}
            placeholder={`Message ${bot.name}`}
            aria-label={`Message ${bot.name}`}
          />
          <PromptInputToolbar className="shrink-0 pb-0.5 pr-0.5">
            <PromptInputSubmit
              className="size-8 rounded-full p-0"
              aria-label={status === "streaming" || status === "submitted" ? "Stop response" : "Send message"}
              status={status}
               onStop={stopTask}
              disabled={status === "ready" && !input.trim()}
            >
              {status === "submitted" ? <Spinner size="sm" /> : status === "streaming" ? <StopIcon size={16} /> : <SendIcon size={16} />}
            </PromptInputSubmit>
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </section>
  );
}

function JobStatusList({ jobs, onRefresh }: { jobs: AgentJob[]; onRefresh: () => Promise<void> }) {
  const visible = jobs.slice(0, 6);
  return (
    <details className="mb-1 rounded-xl border border-white/10 px-3 py-2 text-[#a5a5a5]" aria-label="Task progress">
      <summary className="cursor-pointer text-xs">Task activity · {visible.length} recent {visible.length === 1 ? "run" : "runs"}</summary>
      <div className="mt-3 space-y-2">
      {visible.map((job) => {
        const active = ["queued", "running", "finalizing"].includes(job.status);
        const uncertain = job.status === "uncertain";
        const label = job.status === "waiting_takeover" ? "Waiting for your help" : job.status === "waiting_approval" ? "Waiting for approval" : job.status === "finalizing" ? "Saving result" : job.status === "uncertain" ? "Needs review before retry" : job.status[0]!.toUpperCase() + job.status.slice(1);
        return (
          <div key={job.id} className={`rounded-lg p-3 ring-1 ${uncertain ? "bg-amber-500/10 ring-amber-400/30" : "bg-white/5 ring-white/10"}`}>
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">Task {job.kind}</span><span className="text-xs text-[#a5a5a5]">{job.status === "waiting_approval" || job.status === "waiting_takeover" ? "⏸ " : uncertain ? "⚠ " : ""}{label}{active ? <AnimatedDots /> : null}</span></div>
            {typeof job.checkpoint?.text === "string" && job.checkpoint.text ? <p className="mt-1 line-clamp-2 text-xs text-[#c8c8c8]">{job.checkpoint.text}</p> : null}
            {job.checkpoint ? <p className="mt-1 text-xs text-[#8f8f8f]">Checkpoint saved · attempt {job.attempt}/{job.maxAttempts}</p> : null}
            {job.error ? <p className="mt-1 text-xs text-amber-200">{job.error}</p> : null}
            {uncertain ? <div className="mt-2 flex items-center gap-2"><Button type="button" size="xs" variant="outline" icon={RotateCcwIcon} onClick={() => { if (!window.confirm("Review the external side effects first. Retry this task?")) return; void fetch(`/api/jobs/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry", reviewed: true }) }).then(() => onRefresh()); }}>Review and retry</Button><span className="text-xs text-[#8f8f8f]">Check external side effects first.</span></div> : null}
          </div>
        );
      })}
      </div>
    </details>
  );
}

function ArtifactList({ artifacts, onRevision }: { artifacts: Artifact[]; onRevision: (artifact: Artifact) => void }) {
  return (
    <div className="mt-4 space-y-2" aria-label="Artifacts">
      <p className="text-xs font-medium uppercase tracking-wide text-[#8f8f8f]">Deliverables</p>
      {artifacts.slice(0, 12).map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} onRevision={onRevision} />)}
    </div>
  );
}

function ArtifactCard({ artifact, onRevision }: { artifact: Artifact; onRevision: (artifact: Artifact) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function showPreview() {
    if (preview != null) { setPreview(null); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/artifacts/${artifact.id}?mode=preview`, { cache: "no-store" });
      const json = (await response.json()) as { content?: string };
      setPreview(json.content ?? "Unable to preview this file.");
    } finally { setBusy(false); }
  }
  return (
    <div className="rounded-lg bg-[#1b1b1b] p-3 ring-1 ring-white/10">
      <div className="flex items-start gap-2"><FolderIcon className="mt-0.5 size-4 shrink-0 text-[#8f8f8f]" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{artifact.title}</p><p className="truncate font-mono text-xs text-[#8f8f8f]">{artifact.path}</p>{artifact.description ? <p className="mt-1 text-xs text-[#a5a5a5]">{artifact.description}</p> : null}</div></div>
      <div className="mt-2 flex gap-2"><Button type="button" size="xs" variant="ghost" loading={busy} onClick={() => void showPreview()}>{preview == null ? "Preview" : "Hide preview"}</Button><Button type="button" size="xs" variant="ghost" icon={DownloadIcon} onClick={() => { window.location.href = `/api/artifacts/${artifact.id}?mode=download`; }}>Download</Button><Button type="button" size="xs" variant="outline" onClick={() => onRevision(artifact)}>Request revision</Button></div>
      {preview != null ? <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-xs text-[#d4d4d4]">{preview}</pre> : null}
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
        if (current && current.end == null) setWorkTimer(key, { ...current, end: Date.now() });
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

function formatWorkedDuration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `Worked for ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Worked for ${minutes}m`;
  return `Worked for ${Math.round(minutes / 60)}h`;
}

function collectHandoffIds(messages: UIMessage[]) {
  const ids: string[] = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") continue;
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

function EmptyState({ bot }: { bot: Bot }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: easeOut }}
    >
      <Empty
        icon={<RobotIcon size={48} className="text-[#6d6d6d]" />}
        title={bot.name}
        description={`${bot.job}. No workflow is required. Write as if you were asking a colleague. I will research on the computer, leave artifacts in files, and ask for approval only when needed.`}
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
  onReact: (messageId: string, emoji: MessageReaction, selected: boolean) => Promise<void>;
  actionsDisabled: boolean;
  actionKey: string;
  bubbles: MessageBubble[];
  onLocate: (key: string) => void;
}) {
  const lastPart = message.parts.at(-1);
  const reasoningIsStreaming = isLastMessage && isStreaming && lastPart?.type === "reasoning";
  const cotSteps = buildCotSteps(message.parts, reasoningIsStreaming, handoffs, bots);
  const cotWorking = cotSteps.length > 0 && isLastMessage && isStreaming;
  const workedMs = useWorkedDuration(workKey, cotWorking);
  const replyTo = replyReference(message);
  const canAct = !actionsDisabled && (message.role === "user" || message.role === "assistant");

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: easeOut }}
    >
    <Message from={message.role} data-message="" data-message-key={bubbles.length ? undefined : actionKey} tabIndex={-1} className="scroll-mt-4 rounded-xl outline-none">
      {cotSteps.length > 0 ? (
        <ChainOfThought defaultOpen={cotWorking}>
          <ChainOfThoughtHeader>
            {cotWorking ? (
              <>
                Working
                <AnimatedDots />
              </>
            ) : workedMs != null ? (
              formatWorkedDuration(workedMs)
            ) : (
              "Thinking"
            )}
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            {cotSteps.map((step) => (
              <ChainOfThoughtStep
                key={step.key}
                icon={step.icon}
                label={step.label}
                description={step.description}
                status={step.status}
              >
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
                          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        >
                          <ChainOfThoughtSearchResult className="cursor-pointer hover:bg-white/15">
                            {site.host}
                          </ChainOfThoughtSearchResult>
                        </a>
                      ) : (
                        <ChainOfThoughtSearchResult key={site.host}>{site.host}</ChainOfThoughtSearchResult>
                      ),
                    )}
                  </ChainOfThoughtSearchResults>
                ) : null}
              </ChainOfThoughtStep>
            ))}
          </ChainOfThoughtContent>
        </ChainOfThought>
      ) : null}
      <div
        className={
          message.role === "user"
            ? "flex max-w-[min(640px,90%)] flex-col items-end gap-1"
            : "flex min-w-0 w-full max-w-[min(640px,92%)] flex-col gap-1"
        }
      >
        {replyTo ? <MessageReferenceCard reference={replyTo} botName="Teammate" onLocate={onLocate} /> : null}
        {message.parts.map((part, index) => {
          const partBubbles = bubbles.filter((bubble) => bubble.partIndex === index);
          if (part.type === "text" && partBubbles.length) {
            return partBubbles.map((bubble) => <div key={bubble.key} data-message-key={bubble.key} tabIndex={-1} className={`group/message flex min-w-0 max-w-full scroll-mt-4 flex-col gap-1 rounded-xl outline-none ${message.role === "user" ? "items-end" : "items-start"}`}>
              <MessageActions text={bubble.text} reactions={reactions[bubble.key] ?? []} disabled={!canAct} onReply={() => onReply({ key: bubble.key, role: bubble.role, text: bubble.text.slice(0, 4000) })} onReact={(emoji, selected) => onReact(bubble.key, emoji, selected)}>
                <MessageContent>
                  <MessageResponse isAnimating={isLastMessage && isStreaming && bubble.key === bubbles.at(-1)?.key}>{bubble.text}</MessageResponse>
                </MessageContent>
              </MessageActions>
            </div>);
          }
          return <PartView key={`${message.id}-${index}`} part={part} onApprove={onApprove} isAnimating={isLastMessage && isStreaming} />;
        })}
      </div>
    </Message>
    </motion.div>
  );
});

function MessageReferenceCard({ reference, botName, onLocate }: { reference: MessageReference; botName: string; onLocate: (key: string) => void }) {
  return <button type="button" onClick={() => onLocate(reference.key)} aria-label="Go to referenced message" className="flex min-w-0 max-w-full items-start gap-2 rounded-lg border-l-2 border-[#9ca3af] bg-white/5 px-3 py-2 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white/40">
    <CornerUpLeftIcon size={14} className="mt-0.5 shrink-0 text-neutral-400" />
    <span className="min-w-0"><span className="block text-[11px] font-medium text-neutral-300">Replying to {reference.role === "user" ? "you" : botName}</span><span className="block max-w-full truncate text-xs text-neutral-400">{reference.text.slice(0, 180) || "Message"}</span></span>
  </button>;
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
  icon: LucideIcon;
  label: string;
  description?: ReactNode;
  sites?: StepSite[];
  status: "complete" | "active" | "pending";
};

function buildCotSteps(
  parts: UIMessage["parts"],
  reasoningIsStreaming: boolean,
  handoffs?: Record<string, HandoffSnapshot>,
  bots?: Bot[],
): CotStep[] {
  const steps: CotStep[] = [];

  parts.forEach((part, index) => {
    if (part.type === "reasoning") {
      const text = "text" in part ? String(part.text ?? "") : "";
      if (!text) return;
      const { title, body } = splitReasoningTitle(text);
      const isLastPart = index === parts.length - 1;
      steps.push({
        key: `reasoning-${index}`,
        icon: BrainIcon,
        label: title ?? "Reasoning",
        description: body ? <MessageResponse>{body}</MessageResponse> : undefined,
        status: reasoningIsStreaming && isLastPart ? "active" : "complete",
      });
      return;
    }

    if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") return;
    const toolPart = part as ToolPart;
    const name = toolPart.toolName ?? part.type.replace(/^tool-/, "").replace(/^dynamic-/, "");
    const state = toolPart.state ?? "";
    const input = toolPart.input ?? toolPart.rawInput;
    const errorText =
      toolPart.errorText ?? (toolPart.error != null ? formatDetail(toolPart.error) : "");
    const failed = state === "output-error";

    if (name === "requestTakeover") return;
    if (name === "handoffStatus") return;
    if (toolPart.approval && !toolPart.approval.isAutomatic && state === "approval-requested") {
      return;
    }

    const liveHandoff = name === "messageBot" ? liveHandoffFor(toolPart, handoffs) : undefined;
    steps.push({
      key: toolPart.toolCallId ?? `tool-${index}`,
      icon: toolStepIcon(name),
      label: toolDisplayLabel(name, input, state, liveHandoff, bots),
      description:
        failed && errorText
          ? errorText
          : liveHandoff?.status === "running" && liveHandoff.currentLabel
            ? liveHandoff.currentLabel
            : undefined,
      sites: failed ? undefined : stepSites(name, toolPart.output, input),
      status:
        liveHandoff?.status === "running" || isToolRunning(state) ? "active" : state ? "complete" : "pending",
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

function splitReasoningTitle(text: string): { title?: string; body?: string } {
  const trimmed = text.trimStart();
  const match = trimmed.match(/^\*\*(.+?)\*\*\s*/);
  if (!match) return { body: text || undefined };
  const rest = trimmed.slice(match[0].length).trim();
  return { title: match[1].trim(), body: rest || undefined };
}

function toolStepIcon(name: string): LucideIcon {
  if (name === "browser" || name.toLowerCase().includes("browser")) return GlobeIcon;
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
      return WrenchIcon;
    case "remember":
      return BookOpenIcon;
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

function stepSites(name: string, output: unknown, input: unknown): StepSite[] | undefined {
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
      ...(typeof entry.title === "string" && entry.title ? { title: entry.title } : {}),
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
    const name = toolPart.toolName ?? part.type.replace(/^tool-/, "").replace(/^dynamic-/, "");
    const state = toolPart.state ?? "";
    const input = toolPart.input ?? toolPart.rawInput;
    const errorText =
      toolPart.errorText ?? (toolPart.error != null ? formatDetail(toolPart.error) : "");
    const displayLabel = toolDisplayLabel(name, input, state);
    if (toolPart.approval && !toolPart.approval.isAutomatic) {
      const approval = toolPart.approval;
      const detail = toolApprovalDetail(name, input);
      return (
        <Confirmation approval={approval} state={state}>
          <ConfirmationRequest>
            <ConfirmationTitle>{displayLabel}</ConfirmationTitle>
            {detail ? <p className="font-mono text-xs text-[#c8c8c8]">{detail}</p> : null}
            <ApprovalActions
              onApprove={() => onApprove(approval.id, true)}
              onDeny={() => onApprove(approval.id, false)}
            />
          </ConfirmationRequest>
          <ConfirmationAccepted>
            <ConfirmationTitle>Approved · {displayLabel}</ConfirmationTitle>
            {detail ? <p className="font-mono text-xs text-[#8f8f8f]">{detail}</p> : null}
          </ConfirmationAccepted>
          <ConfirmationRejected>
            <ConfirmationTitle>Declined · {displayLabel}</ConfirmationTitle>
            {detail ? <p className="font-mono text-xs text-[#8f8f8f]">{detail}</p> : null}
          </ConfirmationRejected>
        </Confirmation>
      );
    }
    if (name === "messageBot" || name === "handoffStatus") return null;
    if (name === "requestTakeover") {
      const reason = inputValue(input, "reason");
      const failed = state === "output-error";
      return (
        <Alert variant={failed ? "destructive" : "warning"}>
          <WarningCircleIcon weight="fill" />
          <AlertTitle>{failed ? "Couldn't request your help" : "Requested your help"}</AlertTitle>
          <AlertDescription>
            {failed
              ? errorText || "The computer could not be handed over."
              : `${reason ? `${reason} ` : ""}Take control of the computer to continue.`}
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
      "a teammate";
    if (failed || liveHandoff?.status === "error") return `Couldn't reach ${teammate}`;
    if (liveHandoff?.status === "running") return `${teammate} is working`;
    return completed ? `Asked ${teammate}` : `Asking ${teammate}`;
  }

  if (denied) return "Action was declined";

  if (name === "browser" || name.toLowerCase().includes("browser")) {
    switch (action) {
      case "navigate":
        if (failed) return "Couldn't open the page";
        return completed ? `Opened page` : `Opening page`;
      case "snapshot":
        if (failed) return "Couldn't read the page";
        return completed ? "Read the page" : "Reading the page";
      case "click":
        if (failed) return "Couldn't click the page";
        return completed ? "Clicked the page" : "Clicking the page";
      case "type":
        if (failed) return "Couldn't enter the text";
        return completed ? "Entered text" : "Entering text";
      case "press": {
        const key = inputValue(input, "key") ?? "a key";
        if (failed) return `Couldn't press ${key}`;
        return completed ? `Pressed ${key}` : `Pressing ${key}`;
      }
      case "scroll": {
        const dy = inputNumber(input, "dy");
        const direction = dy != null && dy < 0 ? "up" : "down";
        if (failed) return "Couldn't scroll the page";
        return completed ? `Scrolled ${direction}` : `Scrolling ${direction}`;
      }
      default:
        return failed
          ? "Couldn't use the browser"
          : completed
            ? "Used the browser"
            : "Using the browser";
    }
  }

  const labels: Record<string, [present: string, past: string]> = {
    workspace: ["Updating files", "Updated files"],
    runCommand: ["Running a command", "Ran a command"],
    stopSandbox: ["Stopping the computer", "Stopped the computer"],
    webSearch: ["Searching the web", "Searched the web"],
    remember: ["Saving a memory", "Saved a memory"],
    saveSkill: ["Saving a skill", "Saved a skill"],
    listSkills: ["Checking saved skills", "Checked saved skills"],
    readSkill: ["Reading a skill", "Read a skill"],
    scheduleRoutine: ["Scheduling a routine", "Scheduled a routine"],
    listRoutines: ["Checking routines", "Checked routines"],
    pauseRoutine: ["Updating a routine", "Updated a routine"],
    messageBot: ["Asking a teammate", "Asked a teammate"],
    handoffStatus: ["Checking a teammate", "Checked a teammate"],
    requestTakeover: ["Waiting for your help", "Requested your help"],
  };
  const [present, past] = labels[name] ?? [
    `Working on ${humanizeToolName(name)}`,
    `Finished ${humanizeToolName(name)}`,
  ];
  if (failed) return `Couldn't ${present.charAt(0).toLowerCase()}${present.slice(1)}`;
  return completed ? past : present;
}

function toolApprovalDetail(name: string, input: unknown) {
  if (name === "runCommand") return snippet(inputValue(input, "command"));
  if (name === "workspace") {
    const path = inputValue(input, "path");
    return path ? snippet(path) : undefined;
  }
  return undefined;
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
}: {
  onApprove: () => void;
  onDeny: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
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
        Approve
      </ConfirmationAction>
      <ConfirmationAction
        variant="outline"
        loading={busy === "deny"}
        disabled={busy !== null}
        onClick={() => {
          setBusy("deny");
          onDeny();
        }}
      >
        Deny
      </ConfirmationAction>
    </ConfirmationActions>
  );
}

function RunModePicker({
  value,
  onChange,
}: {
  value: RunMode;
  onChange: (mode: RunMode) => void | Promise<void>;
}) {
  const current = RUN_MODES[value];
  const [busy, setBusy] = useState(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-[#8f8f8f] hover:bg-white/5 hover:text-[#f0f0f0] disabled:opacity-60"
        >
          {busy ? <Spinner size="sm" className="size-3" /> : null}
          {current.label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        {(Object.values(RUN_MODES) as (typeof RUN_MODES)[RunMode][]).map((mode) => (
          <DropdownMenuItem
            key={mode.id}
            disabled={busy}
            onSelect={() => {
              setBusy(true);
              void Promise.resolve(onChange(mode.id)).finally(() => setBusy(false));
            }}
            className={mode.id === value ? "bg-[#2d2d2d]" : undefined}
          >
            <span className="flex min-w-0 flex-col">
              <span>{mode.label}</span>
              <span className="text-[11px] text-[#8f8f8f]">{mode.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function inputValue(input: unknown, key: string) {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
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
    state === "input-streaming" || state === "input-available" || state === "approval-responded"
  );
}

function AnimatedDots() {
  return (
    <span aria-label="in progress" className="animated-dots ml-1" role="img">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}
