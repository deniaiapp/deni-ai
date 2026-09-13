"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { easeOut } from "@/lib/motion";
import {
  ArrowLeftIcon,
  ArrowsOutIcon,
  DownloadSimpleIcon,
  FolderIcon,
  TerminalIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { LoadingFallback } from "@/components/ui/loading";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ComputerState, Routine, ShellRecord, WorkspaceNode } from "@/lib/types";
import { describeRoutineSchedule, formatRoutineTime } from "@/lib/routine-schedule";

type Tab = "screen" | "files" | "terminal" | "log";

type TakeoverInput =
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; dy: number };

function debugComputer(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[computer] ${message}`, details ?? "");
  }
}

export function ComputerPanel({
  computer,
  files,
  shells,
  routines,
  botId,
  botName,
  jobId,
  onRefresh,
  onOpenRoutines,
}: {
  computer: ComputerState;
  files: WorkspaceNode[];
  shells: ShellRecord[];
  routines: Routine[];
  botId?: string;
  botName?: string;
  jobId?: string;
  onRefresh: (capture?: boolean, includeFiles?: boolean) => Promise<void>;
  onOpenRoutines?: (id?: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("screen");
  const [takeover, setTakeover] = useState(false);
  const takeoverActive = takeover && computer.status === "takeover";
  const [screenExpanded, setScreenExpanded] = useState(false);
  const inputQueue = useRef(Promise.resolve());
  const [fileView, setFileView] = useState<{ path: string; content: string } | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [filesBusy, setFilesBusy] = useState(false);
  const [refreshedTab, setRefreshedTab] = useState<Tab | null>(null);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [screenBusy, setScreenBusy] = useState<"takeover" | "close" | null>(null);
  const [readyStamp, setReadyStamp] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ all?: boolean; paths: string[] } | null>(
    null,
  );

  useEffect(() => {
    if (!screenExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setScreenExpanded(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [screenExpanded]);

  const sendTakeoverInput = useCallback(
    (input: TakeoverInput) => {
      const run = inputQueue.current.then(async () => {
        const startedAt = performance.now();
        const safeInput =
          input.type === "type" ? { type: input.type, textLength: input.text.length } : input;
        debugComputer("sending input", safeInput);
        const res = await fetch("/api/computer/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, ...(jobId ? { jobId } : {}) }),
        });
        const response = await res.json().catch(() => null);
        if (!res.ok) {
          console.error("[computer] input rejected", {
            ...safeInput,
            status: res.status,
            response,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
          throw new Error("The computer did not accept the input");
        }
        debugComputer("input accepted", {
          ...safeInput,
          response,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
        await onRefresh(false, false);
      });
      inputQueue.current = run.catch(() => undefined);
      return run;
    },
    [jobId, onRefresh],
  );

  async function clickScreen(e: React.MouseEvent<HTMLElement>) {
    if (!takeoverActive) {
      setScreenExpanded(true);
      return;
    }
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    debugComputer("screen click", {
      clientX: Math.round(e.clientX),
      clientY: Math.round(e.clientY),
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      normalized: { x, y },
    });
    await sendTakeoverInput({ type: "click", x, y });
  }

  async function handleScreenWheel(e: React.WheelEvent<HTMLElement>) {
    if (!takeoverActive) return;
    e.preventDefault();
    await sendTakeoverInput({ type: "scroll", dy: e.deltaY });
  }

  useEffect(() => {
    if (!takeoverActive || computer.steelDebugUrl) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (screenExpanded && event.key === "Escape") return;
      if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        void sendTakeoverInput({ type: "type", text: event.key });
        return;
      }

      const key = [
        event.ctrlKey ? "Control" : null,
        event.altKey ? "Alt" : null,
        event.shiftKey ? "Shift" : null,
        event.metaKey ? "Meta" : null,
        event.key === " " ? "Space" : event.key,
      ]
        .filter(Boolean)
        .join("+");
      if (key) void sendTakeoverInput({ type: "key", key });
    };

    const handlePaste = (event: ClipboardEvent) => {
      event.preventDefault();
      const text = event.clipboardData?.getData("text");
      if (text) void sendTakeoverInput({ type: "type", text });
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("paste", handlePaste, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("paste", handlePaste, true);
    };
  }, [computer.steelDebugUrl, screenExpanded, sendTakeoverInput, takeoverActive]);

  async function toggleTakeover() {
    const next = !takeoverActive;
    debugComputer("toggle takeover", { enabled: next });
    setScreenBusy("takeover");
    try {
      setTakeover(next);
      const res = await fetch("/api/computer/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: next ? "takeover" : "release", ...(jobId ? { jobId } : {}) }),
      });
      debugComputer("toggle takeover response", { enabled: next, status: res.status });
      if (!res.ok) {
        setTakeover(!next);
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || "The computer is currently owned by another task");
      }
      await onRefresh(next, false);
    } finally {
      setScreenBusy(null);
    }
  }

  async function closeBrowser() {
    setScreenBusy("close");
    try {
      await fetch("/api/computer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", ...(jobId ? { jobId } : {}) }),
      });
      setTakeover(false);
      setScreenExpanded(false);
      await onRefresh(false, true);
    } finally {
      setScreenBusy(null);
    }
  }

  async function openFile(path: string) {
    setOpeningPath(path);
    try {
      const res = await fetch(`/api/computer/files?mode=read&path=${encodeURIComponent(path)}`);
      const json = await res.json();
      if (json.content != null) setFileView({ path: json.path, content: json.content });
    } finally {
      setOpeningPath(null);
    }
  }

  const fileNodes = flattenWorkspace(files);
  const filePaths = fileNodes.map((node) => node.path);
  const allSelected = filePaths.length > 0 && filePaths.every((path) => selectedPaths.has(path));
  const someSelected = filePaths.some((path) => selectedPaths.has(path));
  const selectedList = [...selectedPaths];

  function togglePath(path: string, checked: boolean) {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedPaths(checked ? new Set(filePaths) : new Set());
  }

  async function downloadWorkspace(paths: string[]) {
    setFilesBusy(true);
    try {
      const onlyFile =
        paths.length === 1 && fileNodes.find((node) => node.path === paths[0])?.type === "file";
      const res = onlyFile
        ? await fetch(`/api/computer/files?mode=download&path=${encodeURIComponent(paths[0]!)}`)
        : await fetch("/api/computer/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "zip", paths }),
          });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || "Download failed");
      }
      await saveBrowserDownload(res, onlyFile ? downloadLabel(paths[0]!) : "workspace.zip");
    } catch (error) {
      console.error("[computer] download failed", error);
    } finally {
      setFilesBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    setFilesBusy(true);
    try {
      const res = await fetch("/api/computer/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          deleteConfirm.all ? { all: true } : { paths: deleteConfirm.paths },
        ),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || "Delete failed");
      }
      if (
        fileView &&
        (deleteConfirm.all ||
          deleteConfirm.paths.some(
            (path) => fileView.path === path || fileView.path.startsWith(`${path}/`),
          ))
      ) {
        setFileView(null);
      }
      setSelectedPaths(new Set());
      setDeleteConfirm(null);
      await onRefresh(false, true);
    } catch (error) {
      console.error("[computer] delete failed", error);
    } finally {
      setFilesBusy(false);
    }
  }

  function handleScreenshotLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    debugComputer("screenshot loaded", {
      src: e.currentTarget.currentSrc,
      width: e.currentTarget.naturalWidth,
      height: e.currentTarget.naturalHeight,
    });
  }

  function handleScreenshotError(e: React.SyntheticEvent<HTMLImageElement>) {
    console.error("[computer] screenshot failed to load", {
      src: e.currentTarget.currentSrc || e.currentTarget.src,
    });
  }

  const stamp = computer.screenshotAt ?? "none";
  const screenshotQuery = `${jobId ? `&jobId=${encodeURIComponent(jobId)}` : ""}`;
  const statusLabel =
    computer.status === "working"
      ? computer.workingLabel || "Working"
      : computer.status === "takeover"
        ? "Your help is needed"
        : computer.status === "error"
          ? "Error"
          : "Idle";
  const statusVariant =
    computer.status === "working"
      ? "warning"
      : computer.status === "takeover"
        ? "warning"
        : computer.status === "error"
          ? "destructive"
          : "neutral";
  const activeRoutines = botId ? routines.filter((routine) => routine.botId === botId) : [];
  const showScreen = Boolean(
    computer.browserLive || computer.steelDebugUrl || computer.steelSessionId,
  );
  const visibleTab = tab;
  const tabBusy: Tab | null =
    (visibleTab === "files" || visibleTab === "terminal") && refreshedTab !== visibleTab
      ? visibleTab
      : null;
  const shotReady = readyStamp === stamp;

  useEffect(() => {
    if (visibleTab !== "files" && visibleTab !== "terminal") return;
    let cancelled = false;
    void onRefresh(false, visibleTab === "files")
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setRefreshedTab(visibleTab);
      });
    return () => {
      cancelled = true;
    };
  }, [visibleTab, onRefresh]);

  return (
    <aside aria-label="Computer and routines" className="flex h-full w-[304px] max-w-[calc(100vw-2.5rem)] shrink-0 flex-col border-l border-white/10 bg-[#080808] text-[#f0f0f0] 2xl:w-[320px]">
      <header className="flex h-[54px] shrink-0 items-center justify-between border-b border-white/10 px-4">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-[#f0f0f0]">Computer</span>
        </div>
        <Badge variant={statusVariant} appearance="dot">
          {statusLabel}
          {computer.status === "working" ? <AnimatedDots /> : null}
        </Badge>
      </header>

      <div className="px-3 py-2">
        <Tabs value={visibleTab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList className="w-full">
            <TabsTrigger value="screen">Screen</TabsTrigger>
            <TabsTrigger value="files">
              {tabBusy === "files" ? <Spinner size="sm" className="size-3.5" /> : null}
              Files
            </TabsTrigger>
            <TabsTrigger value="terminal">
              {tabBusy === "terminal" ? <Spinner size="sm" className="size-3.5" /> : null}
              Terminal
            </TabsTrigger>
            <TabsTrigger value="log">Log</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={visibleTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: easeOut }}
          >
        {visibleTab === "screen" && !showScreen ? (
          <div className="space-y-3 p-4">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-lg border border-white/5 bg-[#191919] px-5 text-center">
              {computer.status === "working" ? <Spinner size="sm" /> : <TerminalIcon size={24} className="text-[#656565]" />}
              <span className="text-xs text-[#a0a0a0]">{computer.status === "working" ? computer.workingLabel || "Working on your task" : "No browser open"}</span>
            </div>
            <p className="text-center text-xs text-[#8f8f8f]">{botName ? `${botName}'s screen` : "Computer screen"}</p>
            <p className="px-2 text-center text-xs leading-relaxed text-[#6f6f6f]">The screen appears here when your teammate opens the browser.</p>
            {computer.lastError ? <Alert variant="destructive"><AlertTitle>Computer error</AlertTitle><AlertDescription>{computer.lastError}</AlertDescription></Alert> : null}
          </div>
        ) : null}
        {visibleTab === "screen" && showScreen ? (
          <div className="space-y-4 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex flex-col">
                <span className="text-sm font-semibold text-[#f0f0f0]">Screen</span>
                <span className="min-w-0 truncate font-mono text-xs text-[#8f8f8f]">
                  {computer.url || "about:blank"}
                </span>
              </div>
              <div className="flex shrink-0 gap-1">
                {computer.steelDebugUrl ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => setScreenExpanded(true)}
                  >
                    Expand
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="xs"
                    variant={takeoverActive ? "primary" : "outline"}
                    loading={screenBusy === "takeover"}
                    onClick={() => void toggleTakeover()}
                  >
                    {takeoverActive ? "In control" : "Take control"}
                  </Button>
                )}
                <Button
                  type="button"
                  size="xs"
                  variant="secondary-destructive"
                  loading={screenBusy === "close"}
                  onClick={() => void closeBrowser()}
                >
                  Close
                </Button>
              </div>
            </div>
            {computer.steelDebugUrl ? (
              <LiveBrowserView
                url={computer.steelDebugUrl}
                expanded={screenExpanded}
                onExpand={() => setScreenExpanded(true)}
                onClose={() => setScreenExpanded(false)}
              />
            ) : (
              <div className="relative">
                <button
                  type="button"
                  className={`relative block w-full overflow-hidden rounded-lg bg-[#090909] text-left ring-1 ring-white/10 ${
                    takeoverActive ? "" : "cursor-zoom-in"
                  }`}
                  onClick={clickScreen}
                  onWheel={handleScreenWheel}
                  aria-label={takeoverActive ? "Control computer screen" : "Enlarge computer screen"}
                  data-computer-screen="true"
                >
                  {!shotReady ? (
                    <span className="absolute inset-0 z-10 flex items-center justify-center bg-[#090909]">
                      <Spinner size="md" />
                    </span>
                  ) : null}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/computer/screenshot?t=${encodeURIComponent(stamp)}${screenshotQuery}`}
                    alt="Deni Run"
                    onLoad={(event) => {
                      setReadyStamp(stamp);
                      handleScreenshotLoad(event);
                    }}
                    onError={(event) => {
                      setReadyStamp(stamp);
                      handleScreenshotError(event);
                    }}
                    className={`block min-h-40 w-full object-contain bg-[#090909] ${
                      takeoverActive ? "cursor-crosshair" : ""
                    }`}
                  />
                </button>
                <Button
                  type="button"
                  variant="secondary"
                  shape="square"
                  size="xs"
                  icon={ArrowsOutIcon}
                  aria-label="Enlarge computer screen"
                  onClick={() => setScreenExpanded(true)}
                  className="absolute top-2 right-2 bg-[#1b1b1b]/90 text-[#f0f0f0] shadow-lg"
                />
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-[#f0f0f0]">
                {botName ? `${botName}'s screen` : "Computer screen"}
              </span>
              <span className="text-xs tracking-tighter text-[#8f8f8f]">
                {computer.steelDebugUrl
                  ? "Live browser. Click, type, and scroll directly in the remote session."
                  : takeoverActive
                    ? "Click the screen, type, paste, or scroll to control the browser directly."
                    : "The bot's clicks and input appear here. Click the preview to enlarge it."}
              </span>
            </div>
            {computer.lastError ? (
              <Alert variant="destructive">
                <AlertTitle>Computer error</AlertTitle>
                <AlertDescription>{computer.lastError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}

        {visibleTab === "files" ? (
          <div className="p-3">
            {tabBusy === "files" && !fileView ? (
              <LoadingFallback label="Loading files…" />
            ) : openingPath && !fileView ? (
              <LoadingFallback label="Opening file…" />
            ) : fileView ? (
              <div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    icon={ArrowLeftIcon}
                    onClick={() => setFileView(null)}
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    icon={DownloadSimpleIcon}
                    loading={filesBusy}
                    onClick={() => void downloadWorkspace([fileView.path])}
                  >
                    Download
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    icon={TrashIcon}
                    disabled={filesBusy}
                    onClick={() => setDeleteConfirm({ paths: [fileView.path] })}
                  >
                    Delete
                  </Button>
                </div>
                <div className="mt-2">
                  <span className="font-mono text-[0.925rem] text-[#8f8f8f]">{fileView.path}</span>
                </div>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[#0a0a0a] p-3 font-mono text-[0.9em] leading-5 text-[#f0f0f0] ring ring-white/10">
                  {fileView.content}
                </pre>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={(value) => toggleAll(value === true)}
                    disabled={files.length === 0 || filesBusy}
                    aria-label="Select all files"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    icon={DownloadSimpleIcon}
                    loading={filesBusy}
                    disabled={files.length === 0}
                    onClick={() => void downloadWorkspace(selectedList)}
                  >
                    {selectedList.length > 0 ? "Download selected" : "Download all"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    icon={TrashIcon}
                    disabled={files.length === 0 || filesBusy}
                    onClick={() =>
                      setDeleteConfirm(
                        selectedList.length > 0 ? { paths: selectedList } : { all: true, paths: [] },
                      )
                    }
                  >
                    {selectedList.length > 0 ? "Delete selected" : "Delete all"}
                  </Button>
                </div>
                {files.length === 0 ? (
                  <Empty
                    size="sm"
                    icon={<FolderIcon size={32} className="text-[#6d6d6d]" />}
                    title="No files yet"
                  />
                ) : (
                  <FileTree
                    nodes={files}
                    selected={selectedPaths}
                    openingPath={openingPath}
                    busy={filesBusy}
                    onToggle={togglePath}
                    onOpen={(path) => void openFile(path)}
                    onDownload={(path) => void downloadWorkspace([path])}
                    onDelete={(path) => setDeleteConfirm({ paths: [path] })}
                  />
                )}
              </div>
            )}
          </div>
        ) : null}

        {visibleTab === "terminal" ? (
          <div className="space-y-3 p-3">
            {tabBusy === "terminal" ? (
              <LoadingFallback label="Loading terminal…" />
            ) : shells.length === 0 ? (
              <Empty
                size="sm"
                icon={<TerminalIcon size={32} className="text-[#6d6d6d]" />}
                title="No commands yet"
              />
            ) : (
              shells.map((item) => (
                <div key={item.id} className="rounded-lg bg-[#1b1b1b] p-2 ring-1 ring-white/10">
                  <span className="font-mono text-[0.925rem] text-[#f0f0f0]">$ {item.command}</span>
                  {item.stdout ? (
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-[0.9em] text-[#8f8f8f]">
                      {item.stdout}
                    </pre>
                  ) : null}
                  {item.stderr ? (
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-[0.9em] text-red-400">
                      {item.stderr}
                    </pre>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}

        {visibleTab === "log" ? (
          <div className="space-y-2 p-3">
            {computer.activity.length === 0 ? (
              <Empty size="sm" title="No activity yet" />
            ) : (
              computer.activity.map((item, index) => (
                <div
                  key={`${item.at}-${index}`}
                  className="border-b border-white/10 flex flex-col pb-2"
                >
                  <span className="text-xs text-[#8f8f8f]">
                    {item.at.replace("T", " ").slice(0, 19)}
                  </span>
                  <span className="text-[0.925rem] text-[#f0f0f0]">{item.title}</span>
                  {item.detail ? (
                    <span className="text-xs text-[#8f8f8f]">{item.detail}</span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="scroll-thin h-[42%] max-h-[440px] shrink-0 overflow-y-auto px-4 py-6">
        <RoutineList routines={activeRoutines} onOpen={onOpenRoutines} />
      </div>

      <Dialog
        open={Boolean(deleteConfirm)}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm(null);
        }}
      >
        <DialogContent className="p-6">
          <DialogTitle className="text-lg font-semibold">Delete files</DialogTitle>
          <p className="mt-2 text-sm text-[#8f8f8f]">
            {deleteConfirm?.all
              ? "Delete every file in this workspace? This cannot be undone."
              : `Delete ${deleteConfirm?.paths.length ?? 0} item${
                  (deleteConfirm?.paths.length ?? 0) === 1 ? "" : "s"
                }? This cannot be undone.`}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              loading={filesBusy}
              onClick={() => void confirmDelete()}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AnimatePresence>
      {showScreen && screenExpanded && !computer.steelDebugUrl ? (
        <motion.div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged computer screen"
          onClick={() => setScreenExpanded(false)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: easeOut }}
        >
          <div
            className="relative flex max-h-full max-w-full items-center justify-center"
            data-computer-screen="true"
            tabIndex={takeoverActive ? 0 : undefined}
            onWheel={handleScreenWheel}
            onMouseDown={(event) => {
              if (takeoverActive) event.currentTarget.focus();
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              type="button"
              variant="secondary"
              shape="square"
              icon={XIcon}
              aria-label="Close enlarged screen"
              onClick={() => setScreenExpanded(false)}
              className="absolute top-3 right-3 z-10 bg-[#1b1b1b] text-[#f0f0f0] shadow-lg"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/computer/screenshot?t=${encodeURIComponent(stamp)}${screenshotQuery}`}
              alt="Enlarged Deni Run screen"
              onLoad={handleScreenshotLoad}
              onError={handleScreenshotError}
              onClick={takeoverActive ? clickScreen : undefined}
              className={`max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] rounded-lg object-contain ring-1 ring-white/20 ${
                takeoverActive ? "cursor-crosshair" : ""
              }`}
            />
          </div>
        </motion.div>
      ) : null}
      </AnimatePresence>
    </aside>
  );
}

function LiveBrowserView({
  url,
  expanded,
  onExpand,
  onClose,
}: {
  url: string;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
}) {
  const frame = (
    <iframe
      src={url}
      title="Live remote browser"
      allow="clipboard-read; clipboard-write; fullscreen"
      allowFullScreen
      onLoad={() => debugComputer("live browser loaded")}
      className="block h-full w-full border-0 bg-[#090909]"
    />
  );

  if (expanded) {
    return (
      <motion.div
        className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        role="dialog"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, ease: easeOut }}
        aria-modal="true"
        aria-label="Expanded live remote browser"
        onClick={onClose}
      >
        <div
          className="relative h-[90vh] max-h-[800px] w-[90vw] max-w-[1280px] overflow-hidden rounded-lg bg-[#090909] ring-1 ring-white/20"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            type="button"
            variant="secondary"
            shape="square"
            icon={XIcon}
            aria-label="Close enlarged browser"
            onClick={onClose}
            className="absolute top-3 right-3 z-10 bg-[#1b1b1b] text-[#f0f0f0] shadow-lg"
          />
          {frame}
        </div>
      </motion.div>
    );
  }

  return (
    <div className="relative aspect-[8/5] overflow-hidden rounded-lg bg-[#090909] ring-1 ring-white/10">
      {frame}
      <Button
        type="button"
        variant="secondary"
        shape="square"
        size="xs"
        icon={ArrowsOutIcon}
        aria-label="Enlarge live browser"
        onClick={onExpand}
        className="absolute top-2 right-2 z-10 bg-[#1b1b1b]/90 text-[#f0f0f0] shadow-lg"
      />
    </div>
  );
}

function RoutineList({ routines, onOpen }: { routines: Routine[]; onOpen?: (id?: string) => void }) {
  return (
    <section aria-label="Teammate routines" className="space-y-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-[#f0f0f0]">Routines</span>
        {onOpen ? <Button type="button" variant="ghost" size="xs" onClick={() => onOpen()}>Manage</Button> : null}
      </div>
      {routines.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="max-w-60 text-xs leading-relaxed text-[#8f8f8f]">Routines are recurring tasks this teammate runs on a schedule.</p>
          {onOpen ? <Button type="button" variant="outline" size="sm" onClick={() => onOpen("new")}>Create routine</Button> : null}
        </div>
      ) : (
        <div className="space-y-2">
          {routines.map((routine) => (
            <button
              key={routine.id}
              type="button"
              aria-label={`Edit ${routine.name}`}
              onClick={() => onOpen?.(routine.id)}
              disabled={!onOpen}
              className="block w-full rounded-lg bg-[#1b1b1b] px-2.5 py-2 text-left ring-1 ring-white/10 hover:bg-[#252525] focus-visible:outline-2 focus-visible:outline-white/40"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-semibold text-[#f0f0f0]">
                  {routine.name}
                </span>
                <span className={routine.enabled ? "text-[#7ee2a8]" : "text-[#8f8f8f]"}>
                  {routine.enabled ? "Active" : "Paused"}
                </span>
              </div>
              <span className="mt-1 block text-xs text-[#8f8f8f]">{describeRoutineSchedule(routine.cron)}</span>
              <span className="mt-1 block text-[11px] text-[#777777]">{routine.timezone} · {routine.enabled ? `Next ${formatRoutineTime(routine.nextRunAt, routine.timezone)}` : "Off"}</span>
            </button>
          ))}
          {onOpen ? <Button type="button" variant="ghost" size="xs" onClick={() => onOpen("new")}>+ New routine</Button> : null}
        </div>
      )}
    </section>
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

function FileTree({
  nodes,
  selected,
  openingPath,
  busy,
  onToggle,
  onOpen,
  onDownload,
  onDelete,
  depth = 0,
}: {
  nodes: WorkspaceNode[];
  selected: Set<string>;
  openingPath: string | null;
  busy: boolean;
  onToggle: (path: string, checked: boolean) => void;
  onOpen: (path: string) => void;
  onDownload: (path: string) => void;
  onDelete: (path: string) => void;
  depth?: number;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <li key={node.path}>
          <div
            className="group flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-white/5"
            style={{ paddingLeft: 4 + depth * 12 }}
          >
            <Checkbox
              checked={selected.has(node.path)}
              onCheckedChange={(value) => onToggle(node.path, value === true)}
              aria-label={`Select ${node.name}`}
            />
            {node.type === "dir" ? (
              <span className="min-w-0 flex-1 truncate text-sm text-[#8f8f8f]">{node.name}/</span>
            ) : (
              <button
                type="button"
                onClick={() => onOpen(node.path)}
                disabled={Boolean(openingPath)}
                className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate text-left font-mono text-[0.9em] text-[#f0f0f0] hover:text-blue-400 disabled:opacity-60"
              >
                {openingPath === node.path ? <Spinner size="sm" className="size-3.5" /> : null}
                {node.name}
              </button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              shape="square"
              icon={DownloadSimpleIcon}
              aria-label={`Download ${node.name}`}
              disabled={busy}
              className="opacity-0 group-hover:opacity-100"
              onClick={() => onDownload(node.path)}
            />
            <Button
              type="button"
              variant="ghost"
              size="xs"
              shape="square"
              icon={TrashIcon}
              aria-label={`Delete ${node.name}`}
              disabled={busy}
              className="opacity-0 group-hover:opacity-100"
              onClick={() => onDelete(node.path)}
            />
          </div>
          {node.type === "dir" && node.children ? (
            <FileTree
              nodes={node.children}
              selected={selected}
              openingPath={openingPath}
              busy={busy}
              onToggle={onToggle}
              onOpen={onOpen}
              onDownload={onDownload}
              onDelete={onDelete}
              depth={depth + 1}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function flattenWorkspace(nodes: WorkspaceNode[]): WorkspaceNode[] {
  const out: WorkspaceNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.children?.length) out.push(...flattenWorkspace(node.children));
  }
  return out;
}

function downloadLabel(path: string) {
  return path.replace(/^\/+/, "").split("/").at(-1) || "file";
}

async function saveBrowserDownload(res: Response, fallback: string) {
  const blob = await res.blob();
  const header = res.headers.get("Content-Disposition");
  const match = header?.match(/filename="([^"]+)"/);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = match?.[1] || fallback;
  link.click();
  URL.revokeObjectURL(url);
}
