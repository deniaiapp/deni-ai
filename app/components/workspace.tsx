import { useExtracted } from "@/i18n/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { AnimatePresence, motion } from "motion/react";
import { easeOut } from "@/lib/motion";
import type { UIMessage } from "ai";
import { useRouter } from "@tanstack/react-router";
import { MonitorIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sidebar as SidebarAside,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { LoadingFallback } from "@/components/ui/loading";
import { Textarea } from "@/components/ui/textarea";
import type {
  Bot,
  ComputerState,
  Routine,
  Skill,
  Thread,
  WorkspaceNode,
  ShellRecord,
  AppNotification,
  AgentJob,
} from "@/lib/types";
import { ChatThread, forgetChatThread } from "./chat-thread";
import { SetupScreen } from "./setup-screen";
import { BillingDialog } from "./billing-dialog";
import { Sidebar, type TeammateMenuAction } from "./sidebar";
import type { UsageSnapshot } from "@/lib/plans";
import { parseRunMode, type RunMode } from "@/lib/model";
import { canCommitThreadResponse, groupJobsByThread, isActiveJob, jobVisualState, mergeJobSnapshots, shouldMarkThreadUnread } from "@/lib/job-view";
import { cacheThreadMessages } from "@/lib/thread-state";
import { discardChatSession, getChatSession, syncChatSessionMessages, updateChatSessionJobState } from "@/lib/chat-sessions";
import { McpSettings, type McpSignInReturn } from "./mcp-settings";
import { connectorId, takePendingConnect } from "@/lib/connect-intent";
import { NotificationInbox } from "./notification-inbox";
import { RoutinesDialog } from "./routines-dialog";
import { SkillsDialog } from "./skills-dialog";
import { AvatarField } from "./avatar-field";

const LazyComputerPanel = lazy(() =>
  import("./computer-panel").then((mod) => ({ default: mod.ComputerPanel })),
);

function ComputerPanel(props: ComponentProps<typeof LazyComputerPanel>) {
  return (
    <Suspense fallback={<ComputerPanelLoading />}>
      <LazyComputerPanel {...props} />
    </Suspense>
  );
}

function ComputerPanelLoading() {
  const t = useExtracted();
  return (
    <div className="hidden h-full w-[320px] items-center justify-center border-l border-foreground/10 bg-surface xl:flex">
      <LoadingFallback label={t("Loading computer…")} />
    </div>
  );
}

type StatePayload = {
  ready: boolean;
  bots: Bot[];
  threads: Thread[];
  skills: Skill[];
  routines: Routine[];
  computer: ComputerState;
  shells: ShellRecord[];
  usage?: UsageSnapshot;
  runMode?: RunMode;
};

type Modal = "bot" | "group" | "skills" | "routines" | "mcp" | null;

export function Workspace() {
  const t = useExtracted();
  const [boot, setBoot] = useState<"loading" | "setup" | "app">("loading");
  const [bots, setBots] = useState<Bot[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [computer, setComputer] = useState<ComputerState | null>(null);
  const [files, setFiles] = useState<WorkspaceNode[]>([]);
  const [shells, setShells] = useState<ShellRecord[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [messagesByThread, setMessagesByThread] = useState<Record<string, UIMessage[]>>({});
  const messagesByThreadRef = useRef<Record<string, UIMessage[]>>({});
  const [loadedThreadId, setLoadedThreadId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobsByThread, setJobsByThread] = useState<Record<string, AgentJob[]>>({});
  const jobsByThreadRef = useRef<Record<string, AgentJob[]>>({});
  const jobStatusRef = useRef<Record<string, string>>({});
  const jobsRefreshSequence = useRef(0);
  const jobsRequestPending = useRef(false);
  const activeThreadRef = useRef<string | null>(null);
  const threadReady = loadedThreadId != null && loadedThreadId === activeThreadId;
  const [modal, setModal] = useState<Modal>(null);
  const [mcpSignInReturn, setMcpSignInReturn] = useState<McpSignInReturn | null>(null);
  // Connector to start connecting once Plugins opens, from ?connect= or a link followed before sign-in.
  const [autoConnect, setAutoConnect] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pending = takePendingConnect();
    const connect = connectorId(params.get("connect")) ?? pending;
    if (connect) {
      // eslint-disable-next-line react/set-state-in-effect
      setAutoConnect(connect);
      setModal("mcp");
    }
    if (params.get("plugins") === "1") {
      // OAuth returns here; show the newly connected service without keeping the query parameters.
      setModal("mcp");
      // MCP sign-in also reports the connection it finished, or why it failed.
      const connectionId = params.get("mcp");
      const error = params.get("mcpError");
      if (connectionId || error) setMcpSignInReturn({ connectionId, error });
    }
    if (params.get("plugins") === "1" || params.has("connect")) {
      // Keep the router's history state; only the URL changes.
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
    const openPlugins = () => setModal("mcp");
    window.addEventListener("open-plugins", openPlugins);
    return () => window.removeEventListener("open-plugins", openPlugins);
  }, []);
  const [routineEditorId, setRoutineEditorId] = useState<string | null>(null);
  const openRoutines = useCallback((id?: string) => { setRoutineEditorId(id ?? null); setModal("routines"); }, []);
  const [mobileComputer, setMobileComputer] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [editBot, setEditBot] = useState<Bot | null>(null);
  const [editGroup, setEditGroup] = useState<Thread | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sectionThread, setSectionThread] = useState<Thread | null>(null);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [runMode, setRunMode] = useState<RunMode>("default");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const markNotificationRead = useCallback(async (id?: string) => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id } : { all: true }),
    });
    setNotifications((current) =>
      id
        ? current.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item))
        : current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })),
    );
  }, []);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [billingOpen, setBillingOpen] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const teammateLimitReached = Boolean(usage && bots.length >= usage.teammates.limit);
  const canUpgrade = usage?.plan !== "pro";
  const router = useRouter();

  const refreshJobs = useCallback(async () => {
    if (jobsRequestPending.current) return;
    jobsRequestPending.current = true;
    try {
    const sequence = ++jobsRefreshSequence.current;
    const response = await fetch("/api/jobs?overview=1&limit=200&notifications=1", { cache: "no-store" });
    if (!response.ok || sequence !== jobsRefreshSequence.current) return;
    const json = (await response.json()) as { jobs?: AgentJob[]; notifications?: AppNotification[] };
    const mergedJobs = mergeJobSnapshots(Object.values(jobsByThreadRef.current).flat(), json.jobs ?? []);
    const grouped = groupJobsByThread(mergedJobs);
    jobsByThreadRef.current = grouped;
    setJobsByThread(grouped);
    for (const [threadId, jobs] of Object.entries(grouped)) {
      updateChatSessionJobState(threadId, jobs.some(isActiveJob));
    }
    if (json.notifications) setNotifications(json.notifications);
    const nextStatuses: Record<string, string> = {};
    const completedInactive = new Set<string>();
    for (const job of mergedJobs) {
      const previous = jobStatusRef.current[job.id];
      nextStatuses[job.id] = job.status;
      if (shouldMarkThreadUnread(previous as AgentJob["status"] | undefined, job.status, job.threadId, activeThreadRef.current)) {
        completedInactive.add(job.threadId);
      }
    }
    jobStatusRef.current = nextStatuses;
    if (completedInactive.size > 0) {
      setThreads((current) => current.map((thread) => completedInactive.has(thread.id) ? { ...thread, unread: true } : thread));
      for (const threadId of completedInactive) {
        void fetch(`/api/threads/${threadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unread: true }),
        }).catch(() => undefined);
      }
    }
    } finally { jobsRequestPending.current = false; }
  }, []);

  useEffect(() => {
    activeThreadRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    messagesByThreadRef.current = messagesByThread;
  }, [messagesByThread]);

  useEffect(() => {
    if (boot !== "app") return;
    let disposed = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isPageHidden = (): boolean => document.visibilityState === "hidden";
    const refreshIfVisible = async () => {
      const cycle = ++generation;
      clearTimeout(timer);
      if (disposed || isPageHidden()) return;
      try { await refreshJobs(); } catch { /* Retry at the next polling interval. */ }
      if (disposed || cycle !== generation || isPageHidden()) return;
      const running = chatBusy || Object.values(jobsByThreadRef.current).some((jobs) => jobs.some((job) => ["queued", "running", "finalizing"].includes(job.status)));
      timer = setTimeout(() => void refreshIfVisible(), running ? 2_000 : 15_000);
    };
    // eslint-disable-next-line react/set-state-in-effect
    void refreshIfVisible();
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [boot, refreshJobs, chatBusy]);

  const jobStateByThread = useMemo(() => {
    const states: Record<string, "running" | "waiting" | "attention"> = {};
    for (const [threadId, jobs] of Object.entries(jobsByThread)) {
      const state = jobVisualState(jobs);
      if (state) states[threadId] = state;
    }
    return states;
  }, [jobsByThread]);
  const updateThreadJobs = useCallback((threadId: string, jobs: AgentJob[]) => {
    setJobsByThread((current) => {
      const merged = mergeJobSnapshots(current[threadId] ?? [], jobs);
      const next = { ...current, [threadId]: merged };
      jobsByThreadRef.current = next;
      return next;
    });
  }, []);

  const loadState = useCallback(async () => {
    const res = await fetch("/api/state");
    const json = (await res.json()) as StatePayload;
    setBots(json.bots);
    setThreads(json.threads);
    setSkills(json.skills);
    setRoutines(json.routines);
    setComputer(json.computer);
    setShells(json.shells ?? []);
    if (json.usage) setUsage(json.usage);
    if (json.runMode) setRunMode(parseRunMode(json.runMode));
    const notificationResponse = await fetch("/api/notifications?unread=1", { cache: "no-store" });
    if (notificationResponse.ok) {
      const notificationJson = (await notificationResponse.json()) as { notifications?: AppNotification[] };
      setNotifications(notificationJson.notifications ?? []);
    }
      if (!json.ready) {
      setBoot("setup");
      return json;
    }
      setBoot("app");
      return json;
  }, []);

  const openTeammatePaywall = useCallback(() => {
    setModal(null);
    setEditBot(null);
    if (canUpgrade) {
      void router.navigate({ to: "/upgrade", search: { reason: "teammates" } });
      return;
    }
    setBillingOpen(true);
    void loadState();
  }, [canUpgrade, loadState, router]);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const json = await loadState();
      if (cancelled || !json.ready) return;
      setActiveThreadId((current) => current ?? json.threads[0]?.id ?? null);
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [loadState]);

  useEffect(() => {
    if (!activeThreadId) return;
    let cancelled = false;
    const controller = new AbortController();
    const cached = messagesByThreadRef.current[activeThreadId];
    if (cached) {
      setMessages(cached);
      setLoadedThreadId(activeThreadId);
    }
    fetch(`/api/threads/${activeThreadId}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled || !canCommitThreadResponse(activeThreadRef.current, activeThreadId)) return;
        const nextMessages = json.messages ?? [];
        setMessagesByThread((current) => {
          return cacheThreadMessages(current, activeThreadId, nextMessages);
        });
        setMessages(nextMessages);
        syncChatSessionMessages(activeThreadId, nextMessages);
        setLoadedThreadId(activeThreadId);
      })
      .catch(() => undefined);
      return () => {
        cancelled = true;
        controller.abort();
      };
  }, [activeThreadId]);

  const refreshComputer = useCallback(async (capture = false, includeFiles = !capture) => {
    const params = new URLSearchParams();
    if (capture) params.set("refresh", "1");
    if (includeFiles) params.set("files", "1");
    if (activeJobId) params.set("jobId", activeJobId);
    const query = params.toString();
    const res = await fetch(`/api/computer${query ? `?${query}` : ""}`, {
      cache: "no-store",
    });
    const json = await res.json();
    setComputer(json.computer);
    if (includeFiles) setFiles(json.files ?? []);
    setShells(json.shells ?? []);
    if (json.usage) setUsage(json.usage);
  }, [activeJobId]);

  const computerStatus = computer?.status;
  const computerDebugUrl = computer?.steelDebugUrl;
  const browserLive = Boolean(computer?.browserLive || computerDebugUrl);
  const sandboxLive = Boolean(computer?.sandboxLive);

  useEffect(() => {
    if (boot !== "app") return;
    const computerActive = computerStatus === "working" || computerStatus === "takeover";
    if (!chatBusy && !computerActive && !browserLive && !sandboxLive) return;
    const capture = browserLive && !computerDebugUrl;
    // File listings are loaded when the Files tab is opened, not on every heartbeat.
    const includeFiles = false;
    let inFlight = false;
    const refresh = () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      void refreshComputer(capture, includeFiles)
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    refresh();
    const id = setInterval(refresh, chatBusy || capture ? 1200 : 4000);
    return () => clearInterval(id);
  }, [boot, chatBusy, browserLive, sandboxLive, computerStatus, computerDebugUrl, refreshComputer]);

  const handleChatBusyChange = useCallback((busy: boolean) => {
    setChatBusy(busy);
    if (!busy) setMobileComputer(false);
  }, []);

  const patchThread = useCallback((id: string, body: Partial<Thread>) => {
    let previous: Thread | undefined;
    setThreads((list) => {
      previous = list.find((item) => item.id === id);
      if (!previous) return list;
      return list.map((item) => (item.id === id ? { ...item, ...body } : item));
    });
    void fetch(`/api/threads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (res.ok) return;
        throw new Error("thread patch failed");
      })
      .catch(() => {
        const rollback = previous;
        if (!rollback) return;
        setThreads((list) =>
          list.map((item) => {
            if (item.id !== id) return item;
            const stillOptimistic = (Object.keys(body) as (keyof Thread)[]).every(
              (key) => item[key] === body[key],
            );
            return stillOptimistic ? rollback : item;
          }),
        );
      });
  }, []);

  const handleSelectThread = useCallback(
    (id: string) => {
      const thread = threads.find((item) => item.id === id);
      setActiveThreadId(id);
      setActiveJobId(null);
      if (thread?.unread) patchThread(id, { unread: false });
    },
    [threads, patchThread],
  );

  const resetConversation = useCallback(
    async (thread: Thread) => {
      setActionError(null);
      setActionBusyId(thread.id);
      try {
        const response = await fetch(`/api/threads/${encodeURIComponent(thread.id)}/reset`, { method: "POST" });
        const data = (await response.json().catch(() => ({}))) as { error?: string; messages?: UIMessage[] };
        if (!response.ok) throw new Error(data.error || t("Could not reset the conversation."));
        const nextMessages = data.messages ?? [];
        setMessagesByThread((current) => cacheThreadMessages(current, thread.id, nextMessages));
        if (activeThreadRef.current === thread.id) setMessages(nextMessages);
        syncChatSessionMessages(thread.id, nextMessages);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : t("Could not reset the conversation."));
      } finally {
        setActionBusyId(null);
      }
    },
    [t],
  );

  const handleTeammateAction = useCallback(
    async (thread: Thread, bot: Bot, action: TeammateMenuAction) => {
      if (action === "reset") {
        await resetConversation(thread);
        return;
      }
      if (action === "pin") {
        patchThread(thread.id, { pinned: !thread.pinned });
        return;
      }
      if (action === "new-section") {
        setSectionThread(thread);
        return;
      }
      if (action === "remove-section") {
        patchThread(thread.id, { section: null });
        return;
      }
      if (action === "unread") {
        patchThread(thread.id, { unread: !thread.unread });
        return;
      }
      if (thread.kind === "group") {
        setActionError(null);
        if (action === "edit") { setEditGroup(thread); return; }
        if (action === "hide") { patchThread(thread.id, { hidden: !thread.hidden }); return; }
        if (action === "delete" && !window.confirm(t("Delete {title}? The group conversation and its routines will be removed. Teammates and shared files will remain.", { title: thread.title }))) return;
        setActionBusyId(thread.id);
        try {
          if (action === "duplicate") {
            const response = await fetch("/api/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t("{title} copy", { title: thread.title.slice(0, 115) }), botIds: thread.botIds, icon: thread.icon ?? null }) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || t("Could not duplicate group."));
            setThreads((current) => [...current, data.thread]); setActiveThreadId(data.thread.id);
          } else if (action === "delete") {
            const response = await fetch(`/api/threads/${thread.id}`, { method: "DELETE" });
            if (!response.ok && response.status !== 404) throw new Error(t("Could not delete group."));
            discardChatSession(thread.id); forgetChatThread(thread.id);
            setThreads((current) => current.filter((item) => item.id !== thread.id));
            setRoutines((current) => current.filter((item) => item.threadId !== thread.id));
            setMessagesByThread((current) => { const next = { ...current }; delete next[thread.id]; messagesByThreadRef.current = next; return next; });
            setJobsByThread((current) => { const next = { ...current }; delete next[thread.id]; jobsByThreadRef.current = next; return next; });
            if (activeThreadId === thread.id) { setActiveThreadId(threads.find((item) => item.id !== thread.id && !item.hidden)?.id ?? null); setActiveJobId(null); }
          }
        } catch (error) { setActionError(error instanceof Error ? error.message : t("Could not update group.")); }
        finally { setActionBusyId(null); }
        return;
      }
      if (action === "edit") {
        setEditBot(bot);
        return;
      }
      if (action === "duplicate") {
        if (teammateLimitReached && canUpgrade) {
          openTeammatePaywall();
          return;
        }
        setActionBusyId(bot.id);
        try {
          const res = await fetch("/api/bots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: t("{name} copy", { name: bot.name }),
              job: bot.job,
              instructions: bot.instructions,
              icon: bot.icon ?? null,
            }),
          });
          if (res.status === 402) {
            openTeammatePaywall();
            return;
          }
          if (!res.ok) return;
          const json = (await res.json()) as { bot?: Bot; thread?: Thread };
          const createdBot = json.bot;
          const createdThread = json.thread;
          if (!createdBot || !createdThread) return;
          setBots((list) => [...list, createdBot]);
          setThreads((list) => [...list, createdThread]);
          setActiveThreadId(createdThread.id);
        } finally {
          setActionBusyId(null);
        }
        return;
      }
      if (action === "hide") {
        patchThread(thread.id, { hidden: !thread.hidden });
        return;
      }
      if (action === "delete") {
        if (
          !window.confirm(t("Delete {name}? Their conversation and routines will be removed.", { name: bot.name }))
        ) {
          return;
        }
        const previousActive = activeThreadId;
        const removedThreads = threads.filter((item) => item.botIds.includes(bot.id));
        const removedRoutines = routines.filter((item) => item.botId === bot.id);
        const nextThreads = threads.filter((item) => !item.botIds.includes(bot.id));
        setBots((list) => list.filter((item) => item.id !== bot.id));
        setThreads(nextThreads);
        setRoutines((list) => list.filter((item) => item.botId !== bot.id));
        if (activeThreadId && !nextThreads.some((item) => item.id === activeThreadId)) {
          setActiveThreadId(nextThreads[0]?.id ?? null);
        }
        void fetch(`/api/bots/${bot.id}`, { method: "DELETE" })
          .then((res) => {
            if (res.ok) return;
            throw new Error("delete failed");
          })
          .catch(() => {
            setBots((list) => (list.some((item) => item.id === bot.id) ? list : [...list, bot]));
            setThreads((list) => [
              ...list,
              ...removedThreads.filter((item) => !list.some((entry) => entry.id === item.id)),
            ]);
            setRoutines((list) => [
              ...list,
              ...removedRoutines.filter((item) => !list.some((entry) => entry.id === item.id)),
            ]);
            setActiveThreadId(previousActive);
          });
      }
    },
    [
      activeThreadId,
      canUpgrade,
      openTeammatePaywall,
      patchThread,
      resetConversation,
      routines,
      t,
      teammateLimitReached,
      threads,
    ],
  );

  const activeThread = threads.find((item) => item.id === activeThreadId) ?? null;
  const activeBot = activeThread
    ? (bots.find((item) => item.id === activeThread.botIds[0]) ?? bots[0])
    : null;
  const activeChat =
    activeThread && activeBot && threadReady
        ? getChatSession({
            kind: activeThread.kind,
          threadId: activeThread.id,
          botId: activeBot.id,
          runMode,
          jobId: jobsByThread[activeThread.id]?.find(isActiveJob)?.id,
          initialMessages: messages,
          hasPendingJob: jobsByThread[activeThread.id]?.some(isActiveJob),
        })
      : null;

  if (boot === "loading") {
    return (
      <motion.div
        className="flex h-full flex-col items-center justify-center gap-3 bg-background"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, ease: easeOut }}
      >
        <LoadingFallback label={t("Loading…")} />
      </motion.div>
    );
  }

  if (boot === "setup") {
    return (
      <SetupScreen
        onReady={() => {
          loadState().then((json) => {
            if (json?.threads[0]) setActiveThreadId(json.threads[0].id);
          });
        }}
      />
    );
  }

  return (
    <SidebarProvider defaultOpen className="h-full min-h-0 bg-surface-7">
      <SidebarReopenButton />
      <SidebarAside className="border-r border-foreground/10 bg-surface">
        <Sidebar
          notifications={<NotificationInbox notifications={notifications} onRead={markNotificationRead} />}
          bots={bots}
          threads={threads}
          skills={skills}
          routines={routines}
          activeThreadId={activeThreadId}
          onSelectThread={handleSelectThread}
          onNewBot={() => {
            if (teammateLimitReached && canUpgrade) {
              openTeammatePaywall();
              return;
            }
            setModal("bot");
          }}
          onNewGroup={() => setModal("group")}
          onOpenSkills={() => setModal("skills")}
           onOpenRoutines={() => openRoutines()}
           onOpenMcp={() => setModal("mcp")}
          onTeammateAction={handleTeammateAction}
          usage={usage}
          loadingThreadId={activeThreadId && !threadReady ? activeThreadId : null}
           actionBusyId={actionBusyId}
           jobStateByThread={jobStateByThread}
          onOpenBilling={() => {
            setBillingOpen(true);
            void loadState();
          }}
        />
      </SidebarAside>

      <motion.div
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.05, ease: easeOut }}
      >
        <div className="flex items-center justify-between border-b border-foreground/10 bg-background px-3 py-2 md:hidden">
          <SidebarTrigger />
          <span className="text-[0.925rem] text-foreground">{activeBot?.name ?? "Deni Run"}</span>
          {computer ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              icon={MonitorIcon}
              onClick={() => setMobileComputer(true)}
            >
              {t("Computer")}
            </Button>
          ) : null}
        </div>

        {actionError ? <div role="alert" className="flex items-center justify-between gap-3 bg-destructive-500/10 px-4 py-2 text-sm text-destructive-300"><span>{actionError}</span><button type="button" onClick={() => setActionError(null)} className="text-xs underline">{t("Dismiss")}</button></div> : null}

        {activeThread && activeBot && threadReady ? (
          <ChatThread
            key={activeThread.id}
            thread={activeThread}
            bot={activeBot}
            bots={bots}
            runMode={runMode}
            onRunModeChange={async (mode) => {
              setRunMode(mode);
              await fetch("/api/state", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ runMode: mode }),
              });
            }}
            onBusyChange={handleChatBusyChange}
            onActiveJobChange={setActiveJobId}
            onResetConversation={() => void resetConversation(activeThread)}
            resetting={actionBusyId === activeThread.id}
            chat={activeChat!}
            backgroundJobs={jobsByThread[activeThread.id] ?? []}
            onJobsChange={(nextJobs) => updateThreadJobs(activeThread.id, nextJobs)}
          />
        ) : activeThreadId ? (
          <motion.div
            className="flex flex-1 flex-col items-center justify-center bg-background"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, ease: easeOut }}
          >
            <LoadingFallback label={t("Loading…")} />
          </motion.div>
        ) : (
          <motion.div
            className="flex flex-1 items-center justify-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: easeOut }}
          >
            <Empty size="sm" title={t("Select a teammate")} />
          </motion.div>
        )}
      </motion.div>

      {computer ? (
        <motion.div
          className="hidden h-full shrink-0 xl:flex"
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: easeOut }}
        >
          <ComputerPanel
            onOpenRoutines={openRoutines}
            computer={computer}
            files={files}
            shells={shells}
            routines={routines}
            botId={activeBot?.id}
            botName={activeBot?.name}
            jobId={activeJobId ?? undefined}
            onRefresh={refreshComputer}
          />
        </motion.div>
      ) : null}

      <McpSettings open={modal === "mcp"} signInReturn={mcpSignInReturn} autoConnect={autoConnect} onAutoConnectStarted={() => setAutoConnect(null)} onOpenChange={(open) => { setModal(open ? "mcp" : null); if (!open) { setMcpSignInReturn(null); setAutoConnect(null); } }} />

      {computer ? (
        <Button
          type="button"
          variant="primary"
          size="sm"
          icon={MonitorIcon}
          onClick={() => setMobileComputer(true)}
          className="fixed right-4 bottom-4 z-20 hidden md:inline-flex xl:hidden"
        >
          {t("Computer")}
        </Button>
      ) : null}

      <AnimatePresence>
        {mobileComputer && computer ? (
          <motion.div
            className="fixed inset-0 z-30 flex bg-black/80 xl:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: easeOut }}
          >
            <button
              type="button"
              className="flex-1"
              aria-label={t("Close computer")}
              onClick={() => setMobileComputer(false)}
            />
            <motion.div
              className="h-full"
              initial={{ x: 28 }}
              animate={{ x: 0 }}
              exit={{ x: 28 }}
              transition={{ duration: 0.28, ease: easeOut }}
            >
              <ComputerPanel
                onOpenRoutines={(id) => { setMobileComputer(false); openRoutines(id); }}
                computer={computer}
                files={files}
                shells={shells}
                routines={routines}
                botId={activeBot?.id}
                botName={activeBot?.name}
                jobId={activeJobId ?? undefined}
                onRefresh={refreshComputer}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <BotDialog
        open={modal === "bot" || Boolean(editBot)}
        bot={editBot}
        onClose={() => {
          setModal(null);
          setEditBot(null);
        }}
        onLimitReached={openTeammatePaywall}
        onCreated={(bot, thread) => {
          setBots((list) => [...list, bot]);
          setThreads((list) => [...list, thread]);
          setActiveThreadId(thread.id);
          setModal(null);
          void loadState();
        }}
        onUpdated={(bot) => {
          setBots((list) => list.map((item) => (item.id === bot.id ? bot : item)));
          setThreads((list) =>
            list.map((item) =>
              item.kind === "dm" && item.botIds[0] === bot.id ? { ...item, title: bot.name } : item,
            ),
          );
          setEditBot(null);
        }}
      />
      <SectionDialog
        open={Boolean(sectionThread)}
        existing={[
          ...new Set(
            threads.map((item) => item.section).filter((name): name is string => Boolean(name)),
          ),
        ]}
        onClose={() => setSectionThread(null)}
        onSubmit={(name) => {
          if (!sectionThread) return;
          patchThread(sectionThread.id, { section: name });
          setSectionThread(null);
        }}
      />
      <GroupDialog
        open={modal === "group" || Boolean(editGroup)}
        thread={editGroup}
        bots={bots}
        onClose={() => { setModal(null); setEditGroup(null); }}
        onUpdated={(thread) => { setThreads((current) => current.map((item) => item.id === thread.id ? thread : item)); setEditGroup(null); void loadState(); }}
        onCreated={(thread) => {
          setThreads((list) => [...list, thread]);
          setActiveThreadId(thread.id);
          setModal(null);
        }}
      />
      <SkillsDialog open={modal === "skills"} skills={skills} onSync={setSkills} onClose={() => setModal(null)} onDeleted={(id) => setSkills((current) => current.filter((skill) => skill.id !== id))} onSaved={(skill) => setSkills((current) => current.some((item) => item.id === skill.id) ? current.map((item) => item.id === skill.id ? skill : item) : [...current, skill])} />
      <RoutinesDialog
        open={modal === "routines"}
        routines={routines} bots={bots} threads={threads}
        initialRoutineId={routineEditorId}
        defaultBotId={activeBot?.id} defaultThreadId={activeThread?.id}
        onClose={() => setModal(null)} onSync={setRoutines}
        onSaved={(routine) => setRoutines((current) => current.some((item) => item.id === routine.id) ? current.map((item) => item.id === routine.id ? routine : item) : [...current, routine])}
        onDeleted={(id) => setRoutines((current) => current.filter((item) => item.id !== id))}
      />
      <BillingDialog
        open={billingOpen}
        usage={usage}
        busy={billingBusy}
        onClose={() => setBillingOpen(false)}
        onUpgrade={() => {
          setBillingOpen(false);
          void router.navigate({ to: "/upgrade" });
        }}
        onManage={async () => {
          setBillingBusy(true);
          try {
            const res = await fetch("/api/billing/portal", { method: "POST" });
            const json = (await res.json()) as { url?: string };
            if (json.url) window.location.href = json.url;
          } finally {
            setBillingBusy(false);
          }
        }}
      />
    </SidebarProvider>
  );
}

function SidebarReopenButton() {
  const { open } = useSidebar();

  if (open) return null;

  return (
    <SidebarTrigger className="fixed top-3 left-3 z-50 hidden bg-surface-raised text-neutral-208 shadow-lg ring-1 ring-foreground/10 hover:bg-surface-hover md:flex" />
  );
}

function DialogHeader({ title }: { title: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
    </div>
  );
}

function BotDialog({
  open,
  bot,
  onClose,
  onCreated,
  onUpdated,
  onLimitReached,
}: {
  open: boolean;
  bot?: Bot | null;
  onClose: () => void;
  onCreated: (bot: Bot, thread: Thread) => void;
  onUpdated: (bot: Bot) => void;
  onLimitReached: () => void;
}) {
  const t = useExtracted();
  const [name, setName] = useState(bot?.name ?? "");
  const [job, setJob] = useState(bot?.job ?? "");
  const [instructions, setInstructions] = useState(bot?.instructions ?? "");
  const [icon, setIcon] = useState<string | null>(bot?.icon ?? null);
  const [iconBusy, setIconBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(bot);

  useEffect(() => {
    if (!open) return;
    // Preserve the mounted dialog through its exit animation; reset the form on the next opening.
    // eslint-disable-next-line react/set-state-in-effect
    setName(bot?.name ?? "");
    setJob(bot?.job ?? "");
    setInstructions(bot?.instructions ?? "");
    setIcon(bot?.icon ?? null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bot?.id]);

  async function save() {
    if (iconBusy) return;
    setError(null);
    setBusy(true);
    try {
      if (bot) {
        const res = await fetch(`/api/bots/${bot.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, job, instructions, icon }),
        });
        const json = (await res.json()) as { bot?: Bot; error?: string };
        if (!res.ok || !json.bot) throw new Error(json.error || t("Could not save profile."));
        if (json.bot) onUpdated(json.bot);
        return;
      }
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, job, instructions, icon }),
      });
      if (res.status === 402) {
        onLimitReached();
        return;
      }
      const json = await res.json();
      if (!res.ok || !json.bot || !json.thread) throw new Error(json.error || t("Could not create teammate."));
      setName("");
      setJob("");
      setInstructions("");
      setIcon(null);
      onCreated(json.bot, json.thread);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not save profile."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy && !iconBusy) onClose();
      }}
    >
      <DialogContent className="p-6">
        <DialogHeader title={isEdit ? t("Edit profile") : t("New teammate")} />
        <div className="flex flex-col gap-3">
          <AvatarField name={name} accent={bot?.accent} value={icon} onChange={setIcon} disabled={busy} onBusyChange={setIconBusy} />
          {error ? <p role="alert" className="text-sm text-destructive-300">{error}</p> : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bot-name">{t("Name")}</Label>
            <Input id="bot-name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bot-job">{t("Job")}</Label>
            <Input id="bot-job" value={job} onChange={(e) => setJob(e.currentTarget.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bot-instructions">{t("Instructions")}</Label>
            <Textarea
              id="bot-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.currentTarget.value)}
              rows={4}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose disabled={busy || iconBusy} render={<Button variant="secondary" />}>{t("Close")}</DialogClose>
          <Button
            type="button"
            variant="primary"
            disabled={!name.trim() || iconBusy}
            loading={busy}
            onClick={save}
          >
            {isEdit ? t("Save") : t("Create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionDialog({
  open,
  existing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  existing: string[];
  onClose: () => void;
  onSubmit: (name: string) => void | Promise<void>;
}) {
  const t = useExtracted();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Reset the form without remounting the dialog during its close animation.
    // eslint-disable-next-line react/set-state-in-effect
    if (open) setName("");
  }, [open]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="p-6">
        <DialogHeader title={t("Move to new section")} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="section-name">{t("Section name")}</Label>
          <Input
            id="section-name"
            value={name}
            list="section-names"
            autoFocus
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
          {existing.length > 0 ? (
            <datalist id="section-names">
              {existing.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          ) : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose render={<Button variant="secondary" />}>{t("Close")}</DialogClose>
          <Button
            type="button"
            variant="primary"
            disabled={!name.trim()}
            loading={busy}
            onClick={submit}
          >
            {t("Move")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GroupDialog({
  open,
  bots,
  thread,
  onClose,
  onCreated,
  onUpdated,
}: {
  open: boolean;
  bots: Bot[];
  thread?: Thread | null;
  onClose: () => void;
  onCreated: (thread: Thread) => void;
  onUpdated: (thread: Thread) => void;
}) {
  const t = useExtracted();
  const [picked, setPicked] = useState<string[]>(thread?.botIds ?? []);
  const [title, setTitle] = useState(thread?.title ?? "");
  const [icon, setIcon] = useState<string | null>(thread?.icon ?? null);
  const [iconBusy, setIconBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Preserve the mounted dialog through its exit animation; reset the form on the next opening.
    // eslint-disable-next-line react/set-state-in-effect
    setPicked(thread?.botIds ?? []);
    setTitle(thread?.title ?? "");
    setIcon(thread?.icon ?? null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, thread?.id]);

  function toggleBot(botId: string, checked: boolean) {
    setPicked((current) => (checked ? [...new Set([...current, botId])] : current.filter((id) => id !== botId)));
  }

  async function create() {
    if (iconBusy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(thread ? `/api/threads/${thread.id}` : "/api/threads", {
        method: thread ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, botIds: picked, icon }),
      });
      const json = await res.json();
      if (!res.ok || !json.thread) throw new Error(json.error || t("Could not save group."));
      if (thread) { onUpdated(json.thread); return; }
      if (json.thread) {
        setPicked([]);
        setTitle("");
        setIcon(null);
        onCreated(json.thread);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save group.")); }
    finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy && !iconBusy) onClose();
      }}
    >
      <DialogContent className="p-6">
        <DialogHeader title={thread ? t("Edit group") : t("New group")} />
        <div className="flex flex-col gap-3">
          <AvatarField name={title || t("Group")} value={icon} onChange={setIcon} disabled={busy} onBusyChange={setIconBusy} />
          {error ? <p role="alert" className="text-sm text-destructive-300">{error}</p> : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-title">{t("Name")}</Label>
            <Input
              id="group-title"
              value={title}
              maxLength={120}
              disabled={busy}
              onChange={(e) => setTitle(e.currentTarget.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-neutral-224">{t("Members")}</span>
            {bots.map((bot) => (
              <Label key={bot.id} className="cursor-pointer font-normal">
                <Checkbox
                  checked={picked.includes(bot.id)}
                  disabled={busy}
                  onCheckedChange={(checked) => toggleBot(bot.id, checked === true)}
                />
                {bot.name}
              </Label>
            ))}
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button
            type="button"
            variant="primary"
            disabled={picked.length < 2 || iconBusy || (Boolean(thread) && !title.trim())}
            loading={busy}
            onClick={create}
          >
            {thread ? t("Save changes") : t("Create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
