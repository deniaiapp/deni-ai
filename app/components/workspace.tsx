"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { easeOut } from "@/lib/motion";
import type { UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { MonitorIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
} from "@/lib/types";
import dynamic from "next/dynamic";
import { ChatThread } from "./chat-thread";
import { SetupScreen } from "./setup-screen";
import { BillingDialog } from "./billing-dialog";
import { Sidebar, type TeammateMenuAction } from "./sidebar";
import type { UsageSnapshot } from "@/lib/plans";
import { parseRunMode, type RunMode } from "@/lib/model";

const ComputerPanel = dynamic(
  () => import("./computer-panel").then((mod) => ({ default: mod.ComputerPanel })),
  {
    loading: () => (
      <div className="hidden h-full w-[320px] items-center justify-center border-l border-white/10 bg-[#111111] xl:flex">
        <LoadingFallback label="Loading computer…" />
      </div>
    ),
  },
);

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

type Modal = "bot" | "group" | "skills" | "routines" | null;

export function Workspace() {
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
  const [threadReady, setThreadReady] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [mobileComputer, setMobileComputer] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [editBot, setEditBot] = useState<Bot | null>(null);
  const [sectionThread, setSectionThread] = useState<Thread | null>(null);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [runMode, setRunMode] = useState<RunMode>("max");
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [billingOpen, setBillingOpen] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const teammateLimitReached = Boolean(usage && bots.length >= usage.teammates.limit);
  const canUpgrade = usage?.plan !== "pro";
  const router = useRouter();

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
      router.push("/upgrade?reason=teammates");
      return;
    }
    setBillingOpen(true);
    void loadState();
  }, [canUpgrade, loadState, router]);

  useEffect(() => {
    loadState().then((json) => {
      if (!json || !json.ready) return;
      setActiveThreadId((current) => current ?? json.threads[0]?.id ?? null);
    });
  }, [loadState]);

  useEffect(() => {
    if (!activeThreadId) return;
    let cancelled = false;
    setThreadReady(false);
    fetch(`/api/threads/${activeThreadId}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setMessages(json.messages ?? []);
        setThreadReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeThreadId]);

  const refreshComputer = useCallback(async (capture = false, includeFiles = !capture) => {
    const params = new URLSearchParams();
    if (capture) params.set("refresh", "1");
    if (includeFiles) params.set("files", "1");
    const query = params.toString();
    const res = await fetch(`/api/computer${query ? `?${query}` : ""}`, {
      cache: "no-store",
    });
    const json = await res.json();
    setComputer(json.computer);
    if (includeFiles) setFiles(json.files ?? []);
    setShells(json.shells ?? []);
    if (json.usage) setUsage(json.usage);
  }, []);

  const computerStatus = computer?.status;
  const computerDebugUrl = computer?.steelDebugUrl;
  const browserLive = Boolean(computer?.browserLive || computerDebugUrl);
  const sandboxLive = Boolean(computer?.sandboxLive);

  useEffect(() => {
    if (boot !== "app") return;
    const computerActive = computerStatus === "working" || computerStatus === "takeover";
    if (!chatBusy && !computerActive && !browserLive && !sandboxLive) return;
    const capture = browserLive && !computerDebugUrl;
    const includeFiles = !chatBusy && !capture;
    let inFlight = false;
    const refresh = () => {
      if (inFlight) return;
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
      if (thread?.unread) patchThread(id, { unread: false });
    },
    [threads, patchThread],
  );

  const handleTeammateAction = useCallback(
    async (thread: Thread, bot: Bot, action: TeammateMenuAction) => {
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
              name: `${bot.name} copy`,
              job: bot.job,
              instructions: bot.instructions,
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
          !window.confirm(`Delete ${bot.name}? Their conversation and routines will be removed.`)
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
      routines,
      teammateLimitReached,
      threads,
    ],
  );

  const activeThread = threads.find((item) => item.id === activeThreadId) ?? null;
  const activeBot = activeThread
    ? (bots.find((item) => item.id === activeThread.botIds[0]) ?? bots[0])
    : null;

  if (boot === "loading") {
    return (
      <motion.div
        className="flex h-full flex-col items-center justify-center gap-3 bg-[#050505]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, ease: easeOut }}
      >
        <LoadingFallback label="Deni Run" />
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
    <SidebarProvider defaultOpen className="h-full min-h-0 bg-[#070707]">
      <SidebarReopenButton />
      <SidebarAside className="border-r border-white/10 bg-[#111111]">
        <Sidebar
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
          onOpenRoutines={() => setModal("routines")}
          onTeammateAction={handleTeammateAction}
          usage={usage}
          loadingThreadId={activeThreadId && !threadReady ? activeThreadId : null}
          actionBusyId={actionBusyId}
          onOpenBilling={() => {
            setBillingOpen(true);
            void loadState();
          }}
        />
      </SidebarAside>

      <motion.div
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#050505]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.05, ease: easeOut }}
      >
        <div className="flex items-center justify-between border-b border-white/10 bg-[#050505] px-3 py-2 md:hidden">
          <SidebarTrigger />
          <span className="text-[0.925rem] text-[#f0f0f0]">{activeBot?.name ?? "Deni Run"}</span>
          {computer ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              icon={MonitorIcon}
              onClick={() => setMobileComputer(true)}
            >
              Computer
            </Button>
          ) : null}
        </div>

        {activeThread && activeBot && threadReady ? (
          <ChatThread
            key={activeThread.id}
            thread={activeThread}
            bot={activeBot}
            bots={bots}
            initialMessages={messages}
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
          />
        ) : activeThreadId ? (
          <motion.div
            className="flex flex-1 flex-col items-center justify-center bg-[#050505]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, ease: easeOut }}
          >
            <LoadingFallback label="Loading teammate…" />
          </motion.div>
        ) : (
          <motion.div
            className="flex flex-1 items-center justify-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: easeOut }}
          >
            <Empty size="sm" title="Select a teammate" />
          </motion.div>
        )}
      </motion.div>

      {computer ? (
        <motion.div
          className="hidden h-full border-l border-white/10 xl:flex"
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: easeOut }}
        >
          <ComputerPanel
            computer={computer}
            files={files}
            shells={shells}
            routines={routines}
            botId={activeBot?.id}
            botName={activeBot?.name}
            onRefresh={refreshComputer}
          />
        </motion.div>
      ) : null}

      {computer ? (
        <Button
          type="button"
          variant="primary"
          size="sm"
          icon={MonitorIcon}
          onClick={() => setMobileComputer(true)}
          className="fixed right-4 bottom-4 z-20 hidden md:inline-flex xl:hidden"
        >
          Computer
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
              aria-label="Close computer"
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
                computer={computer}
                files={files}
                shells={shells}
                routines={routines}
                botId={activeBot?.id}
                botName={activeBot?.name}
                onRefresh={refreshComputer}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <BotDialog
        key={editBot ? `bot-${editBot.id}` : modal === "bot" ? "bot-new" : "bot-closed"}
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
        key={sectionThread ? `section-${sectionThread.id}` : "section-closed"}
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
        open={modal === "group"}
        bots={bots}
        onClose={() => setModal(null)}
        onCreated={(thread) => {
          setThreads((list) => [...list, thread]);
          setActiveThreadId(thread.id);
          setModal(null);
        }}
      />
      <ListDialog open={modal === "skills"} title="Skills" onClose={() => setModal(null)}>
        {skills.length === 0 ? (
          <Empty size="sm" title="No skills yet" />
        ) : (
          skills.map((item) => (
            <Card key={item.id} className="mb-3 p-3">
              <span className="text-[0.925rem] text-[#f0f0f0]">{item.name}</span>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[0.9em] text-[#8f8f8f]">
                {item.body}
              </pre>
            </Card>
          ))
        )}
      </ListDialog>
      <ListDialog open={modal === "routines"} title="Routines" onClose={() => setModal(null)}>
        {routines.length === 0 ? (
          <Empty
            size="sm"
            title="No routines yet"
            description='Ask a bot to "Summarize the inbox every weekday at 9:00" to create a routine.'
          />
        ) : (
          routines.map((item) => (
            <Card key={item.id} className="mb-3 p-3">
              <span className="text-[0.925rem] text-[#f0f0f0]">{item.name}</span>
              <span className="text-xs text-[#8f8f8f]">
                {item.cron} · {item.enabled ? "Active" : "Paused"} · next {item.nextRunAt ?? "—"}
              </span>
              <span className="text-sm text-[#8f8f8f]">{item.instructions}</span>
            </Card>
          ))
        )}
      </ListDialog>
      <BillingDialog
        open={billingOpen}
        usage={usage}
        busy={billingBusy}
        onClose={() => setBillingOpen(false)}
        onUpgrade={() => {
          setBillingOpen(false);
          router.push("/upgrade");
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
    <SidebarTrigger className="fixed top-3 left-3 z-50 hidden bg-[#1b1b1b] text-[#d0d0d0] shadow-lg ring-1 ring-white/10 hover:bg-[#242424] md:flex" />
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
  const [name, setName] = useState(bot?.name ?? "");
  const [job, setJob] = useState(bot?.job ?? "");
  const [instructions, setInstructions] = useState(bot?.instructions ?? "");
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(bot);

  async function save() {
    setBusy(true);
    try {
      if (bot) {
        const res = await fetch(`/api/bots/${bot.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, job, instructions }),
        });
        const json = (await res.json()) as { bot?: Bot };
        if (json.bot) onUpdated(json.bot);
        return;
      }
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, job, instructions }),
      });
      if (res.status === 402) {
        onLimitReached();
        return;
      }
      const json = await res.json();
      setName("");
      setJob("");
      setInstructions("");
      onCreated(json.bot, json.thread);
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
        <DialogHeader title={isEdit ? "Edit profile" : "New teammate"} />
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bot-name">Name</Label>
            <Input id="bot-name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bot-job">Job</Label>
            <Input id="bot-job" value={job} onChange={(e) => setJob(e.currentTarget.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bot-instructions">Instructions</Label>
            <Textarea
              id="bot-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.currentTarget.value)}
              rows={4}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary">Close</Button>
          </DialogClose>
          <Button
            type="button"
            variant="primary"
            disabled={!name.trim()}
            loading={busy}
            onClick={save}
          >
            {isEdit ? "Save" : "Create"}
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
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

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
        <DialogHeader title="Move to new section" />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="section-name">Section name</Label>
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
          <DialogClose asChild>
            <Button variant="secondary">Close</Button>
          </DialogClose>
          <Button
            type="button"
            variant="primary"
            disabled={!name.trim()}
            loading={busy}
            onClick={submit}
          >
            Move
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GroupDialog({
  open,
  bots,
  onClose,
  onCreated,
}: {
  open: boolean;
  bots: Bot[];
  onClose: () => void;
  onCreated: (thread: Thread) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  function toggleBot(botId: string, checked: boolean) {
    setPicked((current) => (checked ? [...current, botId] : current.filter((id) => id !== botId)));
  }

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, botIds: picked }),
      });
      const json = await res.json();
      if (json.thread) {
        setPicked([]);
        setTitle("");
        onCreated(json.thread);
      }
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
        <DialogHeader title="Group" />
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-title">Title</Label>
            <Input
              id="group-title"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[#e0e0e0]">Members</span>
            {bots.map((bot) => (
              <Label key={bot.id} className="cursor-pointer font-normal">
                <Checkbox
                  checked={picked.includes(bot.id)}
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
            disabled={picked.length < 2}
            loading={busy}
            onClick={create}
          >
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ListDialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="p-6" size="lg">
        <DialogHeader title={title} />
        <div className="scroll-thin max-h-[60vh] overflow-auto">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
