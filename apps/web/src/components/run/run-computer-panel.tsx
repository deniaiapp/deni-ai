import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft as ArrowLeftIcon,
  DownloadIcon,
  Folder as FolderIcon,
  Maximize2 as Maximize2Icon,
  MonitorOff as MonitorOffIcon,
  Terminal as TerminalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useExtracted, useLocale } from "use-intl";
import { formatRoutineTime, readRoutineSchedule } from "@deniai/run/jobs/routine-schedule";
import type { ComputerState, Routine, ShellRecord, WorkspaceNode } from "@deniai/run/types";
import { Alert, AlertDescription, AlertTitle } from "@deniai/ui/components/alert";
import { Badge } from "@deniai/ui/components/badge";
import { Button } from "@deniai/ui/components/button";
import { Checkbox } from "@deniai/ui/components/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@deniai/ui/components/dialog";
import { Spinner } from "@deniai/ui/components/spinner";
import { Tabs, TabsList, TabsTrigger } from "@deniai/ui/components/tabs";
import { Link } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { RunApiError, runFetch, type RunCapabilities } from "./run-api";
import { useRunErrorText } from "./run-error-text";

type Tab = "screen" | "files" | "terminal" | "log";

type TakeoverInput =
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; dy: number };

type ComputerResponse = {
  computer: ComputerState;
  files: WorkspaceNode[];
  shells: ShellRecord[];
};

export type RunComputer = {
  computer: ComputerState;
  files: WorkspaceNode[];
  shells: ShellRecord[];
  /** Reload the computer; `capture` takes a new screenshot, `includeFiles` lists the workspace. */
  refresh: (capture?: boolean, includeFiles?: boolean) => Promise<void>;
};

/**
 * The shared computer of the account, as the open conversation sees it. It is polled only
 * while a teammate works or a browser or sandbox is live.
 */
export function useRunComputer({
  initial,
  jobId,
  busy,
}: {
  initial: ComputerState;
  jobId?: string;
  busy: boolean;
}): RunComputer {
  const [computer, setComputer] = useState(initial);
  const [files, setFiles] = useState<WorkspaceNode[]>([]);
  const [shells, setShells] = useState<ShellRecord[]>([]);

  const refresh = useCallback(
    async (capture = false, includeFiles = !capture) => {
      const params = new URLSearchParams();
      if (capture) params.set("refresh", "1");
      if (includeFiles) params.set("files", "1");
      if (jobId) params.set("jobId", jobId);
      const query = params.toString();
      const result = await runFetch<ComputerResponse>(`computer${query ? `?${query}` : ""}`);
      setComputer(result.computer);
      if (includeFiles) setFiles(result.files ?? []);
      setShells(result.shells ?? []);
    },
    [jobId],
  );

  const status = computer.status;
  const debugUrl = computer.steelDebugUrl;
  const browserLive = Boolean(computer.browserLive || debugUrl);
  const sandboxLive = Boolean(computer.sandboxLive);
  const active = busy || status === "working" || status === "takeover";
  const polling = active || browserLive || sandboxLive;
  const capture = browserLive && !debugUrl;

  useEffect(() => {
    let inFlight = false;
    const tick = () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      // File listings load when the Files tab opens, not on every heartbeat.
      void refresh(capture, false)
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    tick();
    if (!polling) return;
    const id = setInterval(tick, busy || capture ? 1200 : 4000);
    return () => clearInterval(id);
  }, [busy, capture, polling, refresh]);

  return { computer, files, shells, refresh };
}

function useRoutineDescription() {
  const t = useExtracted();
  const weekdays = [
    t("Sunday"),
    t("Monday"),
    t("Tuesday"),
    t("Wednesday"),
    t("Thursday"),
    t("Friday"),
    t("Saturday"),
  ];
  return (cron: string) => {
    const schedule = readRoutineSchedule(cron);
    const time = schedule.time;
    switch (schedule.frequency) {
      case "custom":
        return t("Custom: {cron}", { cron });
      case "daily":
        return t("Every day at {time}", { time });
      case "weekdays":
        return t("Weekdays at {time}", { time });
      case "weekly":
        return t("Every {weekday} at {time}", {
          weekday: weekdays[Number(schedule.weekday)] ?? "",
          time,
        });
      default:
        return t("Day {day} of each month at {time}", { day: schedule.day, time });
    }
  };
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-xs text-muted-foreground">
      <Spinner className="size-4" />
      {label}
    </div>
  );
}

function PanelEmpty({ icon, title }: { icon?: React.ReactNode; title: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-muted-foreground">
      {icon}
      {title}
    </div>
  );
}

/**
 * The computer beside a conversation, as in standalone Deni Run: the teammate's screen
 * (a person can take control), its files, terminal and activity log, and its routines.
 */
export function RunComputerPanel({
  computer,
  files,
  shells,
  refresh,
  routines,
  capabilities,
  botId,
  botName,
  jobId,
  className,
}: RunComputer & {
  routines: Routine[];
  capabilities: RunCapabilities | null;
  botId?: string;
  botName?: string;
  jobId?: string;
  className?: string;
}) {
  const t = useExtracted();
  const errorText = useRunErrorText();
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
        await runFetch("computer/input", { body: { ...input, ...(jobId ? { jobId } : {}) } });
        await refresh(false, false);
      });
      inputQueue.current = run.catch(() => undefined);
      return run;
    },
    [jobId, refresh],
  );

  const reportInputError = (error: unknown) =>
    toast.error(
      error instanceof RunApiError && error.code === "computer_input_failed"
        ? t("The computer did not accept the input")
        : errorText(error),
    );

  function clickScreen(event: React.MouseEvent<HTMLElement>) {
    if (!takeoverActive) {
      setScreenExpanded(true);
      return;
    }
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    sendTakeoverInput({ type: "click", x, y }).catch(reportInputError);
  }

  function handleScreenWheel(event: React.WheelEvent<HTMLElement>) {
    if (!takeoverActive) return;
    sendTakeoverInput({ type: "scroll", dy: event.deltaY }).catch(() => undefined);
  }

  const liveUrl = computer.steelDebugUrl;

  useEffect(() => {
    if (!takeoverActive || liveUrl) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (screenExpanded && event.key === "Escape") return;
      if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        sendTakeoverInput({ type: "type", text: event.key }).catch(() => undefined);
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
      if (key) sendTakeoverInput({ type: "key", key }).catch(() => undefined);
    };

    const handlePaste = (event: ClipboardEvent) => {
      event.preventDefault();
      const text = event.clipboardData?.getData("text");
      if (text) sendTakeoverInput({ type: "type", text }).catch(() => undefined);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("paste", handlePaste, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("paste", handlePaste, true);
    };
  }, [liveUrl, screenExpanded, sendTakeoverInput, takeoverActive]);

  async function toggleTakeover() {
    const next = !takeoverActive;
    setScreenBusy("takeover");
    setTakeover(next);
    try {
      await runFetch("computer/input", {
        body: { type: next ? "takeover" : "release", ...(jobId ? { jobId } : {}) },
      });
      await refresh(next, false);
    } catch (error) {
      setTakeover(!next);
      toast.error(errorText(error));
    } finally {
      setScreenBusy(null);
    }
  }

  async function closeBrowser() {
    setScreenBusy("close");
    try {
      await runFetch("computer", { body: { action: "release", ...(jobId ? { jobId } : {}) } });
      setTakeover(false);
      setScreenExpanded(false);
      await refresh(false, true);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setScreenBusy(null);
    }
  }

  async function openFile(path: string) {
    setOpeningPath(path);
    try {
      const file = await runFetch<{ path: string; content: string }>(
        `computer/files?mode=read&path=${encodeURIComponent(path)}`,
      );
      if (file.content != null) setFileView({ path: file.path, content: file.content });
    } catch (error) {
      toast.error(errorText(error));
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

  async function downloadWorkspace(paths: string[]) {
    setFilesBusy(true);
    try {
      const onlyFile =
        paths.length === 1 && fileNodes.find((node) => node.path === paths[0])?.type === "file";
      const response = onlyFile
        ? await fetch(`/api/run/computer/files?mode=download&path=${encodeURIComponent(paths[0]!)}`)
        : await fetch("/api/run/computer/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "zip", paths }),
          });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new RunApiError(
          response.status,
          typeof body.error === "string" ? body.error : `http_${response.status}`,
          body,
        );
      }
      const name = onlyFile
        ? fileLabel(paths[0]!)
        : `${paths.length === 1 ? fileLabel(paths[0]!) : "workspace"}.zip`;
      saveBlob(await response.blob(), name);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setFilesBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    setFilesBusy(true);
    try {
      await runFetch("computer/files", {
        method: "DELETE",
        body: deleteConfirm.all ? { all: true } : { paths: deleteConfirm.paths },
      });
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
      await refresh(false, true);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setFilesBusy(false);
    }
  }

  const stamp = computer.screenshotAt ?? "none";
  const screenshotSrc = `/api/run/computer/screenshot?t=${encodeURIComponent(stamp)}${
    jobId ? `&jobId=${encodeURIComponent(jobId)}` : ""
  }`;
  // The step detail (such as calling a connector) belongs to the conversation, not this badge.
  const statusLabel =
    computer.status === "working"
      ? t("Working")
      : computer.status === "takeover"
        ? t("Your help is needed")
        : computer.status === "error"
          ? t("Error")
          : t("Idle");
  const statusDot =
    computer.status === "working" || computer.status === "takeover"
      ? "bg-amber-500"
      : computer.status === "error"
        ? "bg-destructive"
        : "bg-muted-foreground/50";
  const teammateRoutines = botId ? routines.filter((routine) => routine.botId === botId) : [];
  const unavailable = Boolean(capabilities && !capabilities.browser && !capabilities.sandbox);
  const showScreen = Boolean(computer.browserLive || liveUrl || computer.steelSessionId);
  const tabBusy: Tab | null =
    (tab === "files" || tab === "terminal") && refreshedTab !== tab ? tab : null;
  const shotReady = readyStamp === stamp;
  const screenName = botName ? t("{name}'s screen", { name: botName }) : t("Computer screen");
  const computerError = computer.lastError ? (
    <Alert variant="destructive">
      <AlertTitle>{t("Computer error")}</AlertTitle>
      <AlertDescription>{computer.lastError}</AlertDescription>
    </Alert>
  ) : null;

  useEffect(() => {
    if (tab !== "files" && tab !== "terminal") return;
    let cancelled = false;
    void refresh(false, tab === "files")
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setRefreshedTab(tab);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, refresh]);

  return (
    <aside
      aria-label={t("Computer and routines")}
      className={cn(
        "flex h-full w-[304px] max-w-[calc(100vw-2.5rem)] shrink-0 flex-col border-l bg-sidebar text-sidebar-foreground 2xl:w-[320px]",
        className,
      )}
    >
      <header className="flex h-[54px] shrink-0 items-center justify-between border-b px-4">
        <span className="text-sm font-semibold">{t("Computer")}</span>
        <Badge variant="outline" className="gap-1.5">
          <span aria-hidden className={cn("size-1.5 rounded-full", statusDot)} />
          {statusLabel}
        </Badge>
      </header>

      <div className="px-3 py-2">
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList className="w-full">
            <TabsTrigger value="screen" className="px-1.5">
              {t("Screen")}
            </TabsTrigger>
            <TabsTrigger value="files" className="px-1.5">
              {tabBusy === "files" ? <Spinner className="size-3.5" /> : null}
              {t("Files")}
            </TabsTrigger>
            <TabsTrigger value="terminal" className="px-1.5">
              {tabBusy === "terminal" ? <Spinner className="size-3.5" /> : null}
              {t("Terminal")}
            </TabsTrigger>
            <TabsTrigger value="log" className="px-1.5">
              {t("Log")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "screen" && unavailable ? (
          <div className="p-4">
            <Alert>
              <MonitorOffIcon className="size-4" />
              <AlertTitle>{t("The computer is not available")}</AlertTitle>
              <AlertDescription>
                {t(
                  "No browser or sandbox provider is configured for Run on this server, so teammates work without a computer.",
                )}
              </AlertDescription>
            </Alert>
          </div>
        ) : null}
        {tab === "screen" && !unavailable && !showScreen ? (
          <div className="flex flex-col gap-3 p-4">
            {/* No browser is open, so nothing here is moving; the badge says if work is going on. */}
            <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-lg border bg-muted/40 px-5 text-center">
              <TerminalIcon className="size-6 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{t("No browser open")}</span>
            </div>
            <p className="text-center text-xs text-muted-foreground">{screenName}</p>
            <p className="px-2 text-center text-xs leading-relaxed text-muted-foreground/80">
              {t("The screen appears here when your teammate opens the browser.")}
            </p>
            {computerError}
          </div>
        ) : null}
        {tab === "screen" && !unavailable && showScreen ? (
          <div className="flex flex-col gap-4 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold">{t("Screen")}</span>
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {computer.url || "about:blank"}
                </span>
              </div>
              <div className="flex shrink-0 gap-1">
                {liveUrl ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => setScreenExpanded(true)}
                  >
                    {t("Expand")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="xs"
                    variant={takeoverActive ? "default" : "outline"}
                    disabled={screenBusy === "takeover"}
                    onClick={() => void toggleTakeover()}
                  >
                    {screenBusy === "takeover" ? <Spinner className="size-3" /> : null}
                    {takeoverActive ? t("In control") : t("Take control")}
                  </Button>
                )}
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  disabled={screenBusy === "close"}
                  onClick={() => void closeBrowser()}
                >
                  {screenBusy === "close" ? <Spinner className="size-3" /> : null}
                  {t("Close")}
                </Button>
              </div>
            </div>
            {liveUrl ? (
              <LiveBrowserView
                url={liveUrl}
                expanded={screenExpanded}
                onExpand={() => setScreenExpanded(true)}
                onClose={() => setScreenExpanded(false)}
              />
            ) : (
              <div className="relative">
                <button
                  type="button"
                  className={cn(
                    "relative block w-full overflow-hidden rounded-lg border bg-muted text-left",
                    !takeoverActive && "cursor-zoom-in",
                  )}
                  onClick={clickScreen}
                  onWheel={handleScreenWheel}
                  aria-label={
                    takeoverActive ? t("Control computer screen") : t("Enlarge computer screen")
                  }
                >
                  {!shotReady ? (
                    <span className="absolute inset-0 z-10 flex items-center justify-center bg-muted">
                      <Spinner className="size-5" />
                    </span>
                  ) : null}
                  <img
                    src={screenshotSrc}
                    alt={screenName}
                    onLoad={() => setReadyStamp(stamp)}
                    onError={() => setReadyStamp(stamp)}
                    className={cn(
                      "block min-h-40 w-full bg-muted object-contain",
                      takeoverActive && "cursor-crosshair",
                    )}
                  />
                </button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-xs"
                  aria-label={t("Enlarge computer screen")}
                  onClick={() => setScreenExpanded(true)}
                  className="absolute top-2 right-2 shadow-lg"
                >
                  <Maximize2Icon />
                </Button>
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-sm font-semibold">{screenName}</span>
              <span className="text-xs text-muted-foreground">
                {liveUrl
                  ? t("Live browser. Click, type, and scroll directly in the remote session.")
                  : takeoverActive
                    ? t("Click the screen, type, paste, or scroll to control the browser directly.")
                    : t("The bot's clicks and input appear here. Click the preview to enlarge it.")}
              </span>
            </div>
            {computerError}
          </div>
        ) : null}

        {tab === "files" ? (
          <div className="p-3">
            {tabBusy === "files" && !fileView ? (
              <PanelLoading label={t("Loading files…")} />
            ) : openingPath && !fileView ? (
              <PanelLoading label={t("Opening file…")} />
            ) : fileView ? (
              <div>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="xs" onClick={() => setFileView(null)}>
                    <ArrowLeftIcon />
                    {t("Back")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={filesBusy}
                    onClick={() => void downloadWorkspace([fileView.path])}
                  >
                    {filesBusy ? <Spinner className="size-3" /> : <DownloadIcon />}
                    {t("Download")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={filesBusy}
                    onClick={() => setDeleteConfirm({ paths: [fileView.path] })}
                  >
                    <Trash2Icon />
                    {t("Delete")}
                  </Button>
                </div>
                <p className="mt-2 font-mono text-sm break-all text-muted-foreground">
                  {fileView.path}
                </p>
                <pre className="mt-2 rounded-lg border bg-background p-3 font-mono text-xs leading-5 whitespace-pre-wrap">
                  {fileView.content}
                </pre>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected && !allSelected}
                    onCheckedChange={(value) =>
                      setSelectedPaths(value === true ? new Set(filePaths) : new Set())
                    }
                    disabled={files.length === 0 || filesBusy}
                    aria-label={t("Select all files")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={files.length === 0 || filesBusy}
                    onClick={() => void downloadWorkspace(selectedList)}
                  >
                    {filesBusy ? <Spinner className="size-3" /> : <DownloadIcon />}
                    {selectedList.length > 0 ? t("Download selected") : t("Download all")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={files.length === 0 || filesBusy}
                    onClick={() =>
                      setDeleteConfirm(
                        selectedList.length > 0
                          ? { paths: selectedList }
                          : { all: true, paths: [] },
                      )
                    }
                  >
                    <Trash2Icon />
                    {selectedList.length > 0 ? t("Delete selected") : t("Delete all")}
                  </Button>
                </div>
                {files.length === 0 ? (
                  <PanelEmpty icon={<FolderIcon className="size-8" />} title={t("No files yet")} />
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

        {tab === "terminal" ? (
          <div className="flex flex-col gap-3 p-3">
            {tabBusy === "terminal" ? (
              <PanelLoading label={t("Loading terminal…")} />
            ) : shells.length === 0 ? (
              <PanelEmpty icon={<TerminalIcon className="size-8" />} title={t("No commands yet")} />
            ) : (
              shells.map((item) => (
                <div key={item.id} className="rounded-lg border bg-card p-2">
                  <span className="font-mono text-sm break-all">$ {item.command}</span>
                  {item.stdout ? (
                    <pre className="mt-1 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                      {item.stdout}
                    </pre>
                  ) : null}
                  {item.stderr ? (
                    <pre className="mt-1 font-mono text-xs whitespace-pre-wrap text-destructive">
                      {item.stderr}
                    </pre>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === "log" ? (
          <div className="flex flex-col gap-2 p-3">
            {computer.activity.length === 0 ? (
              <PanelEmpty title={t("No activity yet")} />
            ) : (
              computer.activity.map((item, index) => (
                <div key={`${item.at}-${index}`} className="flex flex-col border-b pb-2">
                  <span className="text-xs text-muted-foreground">
                    {item.at.replace("T", " ").slice(0, 19)}
                  </span>
                  <span className="text-sm">{item.title}</span>
                  {item.detail ? (
                    <span className="text-xs break-words text-muted-foreground">{item.detail}</span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div className="h-[42%] max-h-[440px] shrink-0 overflow-y-auto border-t px-4 py-6">
        <RoutineList routines={teammateRoutines} />
      </div>

      <Dialog
        open={Boolean(deleteConfirm)}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Delete files")}</DialogTitle>
            <DialogDescription>
              {deleteConfirm?.all
                ? t("Delete every file in this workspace? This cannot be undone.")
                : t(
                    "Delete {count, plural, one {# item} other {# items}}? This cannot be undone.",
                    { count: deleteConfirm?.paths.length ?? 0 },
                  )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary" />}>{t("Cancel")}</DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={filesBusy}
              onClick={() => void confirmDelete()}
            >
              {filesBusy ? <Spinner className="size-4" /> : null}
              {t("Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showScreen && screenExpanded && !liveUrl ? (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("Enlarged computer screen")}
          onClick={() => setScreenExpanded(false)}
        >
          <div
            className="relative flex max-h-full max-w-full items-center justify-center"
            onWheel={handleScreenWheel}
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              aria-label={t("Close enlarged screen")}
              onClick={() => setScreenExpanded(false)}
              className="absolute top-3 right-3 z-10 shadow-lg"
            >
              <XIcon />
            </Button>
            <img
              src={screenshotSrc}
              alt={screenName}
              onClick={takeoverActive ? clickScreen : undefined}
              className={cn(
                "max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] rounded-lg object-contain ring-1 ring-white/20",
                takeoverActive && "cursor-crosshair",
              )}
            />
          </div>
        </div>
      ) : null}
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
  const t = useExtracted();
  const frame = (
    <iframe
      src={url}
      title={t("Live remote browser")}
      allow="clipboard-read; clipboard-write; fullscreen"
      sandbox="allow-scripts allow-same-origin"
      className="block h-full w-full border-0 bg-muted"
    />
  );

  if (expanded) {
    return (
      <div
        className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4"
        role="dialog"
        aria-modal="true"
        aria-label={t("Expanded live remote browser")}
        onClick={onClose}
      >
        <div
          className="relative h-[90vh] max-h-[800px] w-[90vw] max-w-[1280px] overflow-hidden rounded-lg bg-muted ring-1 ring-white/20"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label={t("Close enlarged browser")}
            onClick={onClose}
            className="absolute top-3 right-3 z-10 shadow-lg"
          >
            <XIcon />
          </Button>
          {frame}
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-[8/5] overflow-hidden rounded-lg border bg-muted">
      {frame}
      <Button
        type="button"
        variant="secondary"
        size="icon-xs"
        aria-label={t("Enlarge live browser")}
        onClick={onExpand}
        className="absolute top-2 right-2 z-10 shadow-lg"
      >
        <Maximize2Icon />
      </Button>
    </div>
  );
}

function RoutineList({ routines }: { routines: Routine[] }) {
  const t = useExtracted();
  const locale = useLocale();
  const describe = useRoutineDescription();
  return (
    <section aria-label={t("Teammate routines")} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{t("Routines")}</span>
        <Button
          variant="ghost"
          size="xs"
          render={<Link href="/run/routines" />}
          nativeButton={false}
        >
          {t("Manage")}
        </Button>
      </div>
      {routines.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="max-w-60 text-xs leading-relaxed text-muted-foreground">
            {t("Routines are recurring tasks this teammate runs on a schedule.")}
          </p>
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/run/routines" />}
            nativeButton={false}
          >
            {t("Create routine")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {routines.map((routine) => (
            <Link
              key={routine.id}
              href="/run/routines"
              aria-label={t("Edit {name}", { name: routine.name })}
              className="block rounded-lg border bg-card px-2.5 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              <div className="flex items-start justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-semibold">{routine.name}</span>
                <span
                  className={
                    routine.enabled
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground"
                  }
                >
                  {routine.enabled ? t("Active") : t("Paused")}
                </span>
              </div>
              <span className="mt-1 block text-xs text-muted-foreground">
                {describe(routine.cron)}
              </span>
              <span className="mt-1 block text-[11px] text-muted-foreground/80">
                {routine.timezone} ·{" "}
                {routine.enabled
                  ? t("Next {time}", {
                      time: formatRoutineTime(routine.nextRunAt, routine.timezone, locale),
                    })
                  : t("Off")}
              </span>
            </Link>
          ))}
          <Button
            variant="ghost"
            size="xs"
            className="self-start"
            render={<Link href="/run/routines" />}
            nativeButton={false}
          >
            {t("+ New routine")}
          </Button>
        </div>
      )}
    </section>
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
  const t = useExtracted();
  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((node) => (
        <li key={node.path}>
          <div
            className="group flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-foreground/5"
            style={{ paddingLeft: 4 + depth * 12 }}
          >
            <Checkbox
              checked={selected.has(node.path)}
              onCheckedChange={(value) => onToggle(node.path, value === true)}
              aria-label={t("Select {name}", { name: node.name })}
            />
            {node.type === "dir" ? (
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {node.name}/
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onOpen(node.path)}
                disabled={Boolean(openingPath)}
                className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate text-left font-mono text-xs hover:underline disabled:opacity-60"
              >
                {openingPath === node.path ? <Spinner className="size-3.5" /> : null}
                {node.name}
              </button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("Download {name}", { name: node.name })}
              disabled={busy}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => onDownload(node.path)}
            >
              <DownloadIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("Delete {name}", { name: node.name })}
              disabled={busy}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => onDelete(node.path)}
            >
              <Trash2Icon />
            </Button>
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

function fileLabel(path: string) {
  return path.replace(/^\/+/, "").split("/").at(-1) || "file";
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
