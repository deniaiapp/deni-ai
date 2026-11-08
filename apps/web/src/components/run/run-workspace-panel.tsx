import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileText, MonitorOff, MousePointerClick, RotateCw, Square } from "lucide-react";
import { toast } from "sonner";
import { useExtracted, useFormatter } from "use-intl";
import { Alert, AlertDescription, AlertTitle } from "@deniai/ui/components/alert";
import { Badge } from "@deniai/ui/components/badge";
import { Button } from "@deniai/ui/components/button";
import { Spinner } from "@deniai/ui/components/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@deniai/ui/components/tabs";
import {
  runFetch,
  runKeys,
  useInvalidateRun,
  useJobEvents,
  useThreadArtifacts,
  useThreadJobs,
  type AgentJob,
  type Artifact,
  type RunCapabilities,
} from "./run-api";
import { useRunErrorText } from "./run-error-text";

const ACTIVE = ["queued", "running", "finalizing", "waiting_approval", "waiting_takeover"];

export function useJobStatusLabel() {
  const t = useExtracted();
  return (status: AgentJob["status"]) =>
    ({
      queued: t("Queued"),
      running: t("Working"),
      finalizing: t("Finishing"),
      waiting_approval: t("Waiting for approval"),
      waiting_takeover: t("Waiting for you"),
      paused: t("Paused"),
      uncertain: t("Needs review"),
      completed: t("Done"),
      failed: t("Failed"),
      cancelled: t("Stopped"),
    })[status] ?? status;
}

function JobRow({ job }: { job: AgentJob }) {
  const t = useExtracted();
  const format = useFormatter();
  const label = useJobStatusLabel();
  const errorText = useRunErrorText();
  const invalidate = useInvalidateRun();
  const [open, setOpen] = useState(false);
  const events = useJobEvents(job.id, open);
  const act = useMutation({
    mutationFn: (body: { action: string; reviewed?: boolean }) =>
      runFetch(`jobs/${job.id}`, { body }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorText(error)),
  });
  const active = ACTIVE.includes(job.status);
  const checkpoint = job.checkpoint as { text?: string; step?: number } | null;
  return (
    <li className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left text-sm"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {active ? <Spinner className="size-3" /> : null}
          <Badge variant={job.status === "failed" ? "destructive" : "secondary"}>
            {label(job.status)}
          </Badge>
          <span className="truncate text-muted-foreground">
            {format.dateTime(new Date(job.createdAt), { dateStyle: "short", timeStyle: "short" })}
          </span>
        </button>
        <div className="flex gap-1">
          {active ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={act.isPending}
              onClick={() => act.mutate({ action: "cancel" })}
            >
              <Square className="size-3" />
              {t("Stop")}
            </Button>
          ) : null}
          {job.status === "failed" || job.status === "uncertain" ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={act.isPending}
              onClick={() => act.mutate({ action: "retry", reviewed: job.status === "uncertain" })}
            >
              <RotateCw className="size-3" />
              {job.status === "uncertain" ? t("Reviewed, retry") : t("Retry")}
            </Button>
          ) : null}
        </div>
      </div>
      {checkpoint?.text ? (
        <p className="line-clamp-3 text-xs text-muted-foreground">{checkpoint.text}</p>
      ) : null}
      {job.error ? <p className="text-xs text-destructive">{job.error}</p> : null}
      {open ? (
        <ol className="flex flex-col gap-1 border-l pl-3 text-xs text-muted-foreground">
          {events.isLoading ? <Spinner className="size-3" /> : null}
          {events.data?.events.map((event) => (
            <li key={event.id}>
              <span className="font-mono">#{event.sequence}</span> {event.kind}
              {typeof event.payload.step === "number"
                ? ` · ${t("step {step}", { step: String(event.payload.step) })}`
                : ""}
            </li>
          ))}
          {events.data && events.data.events.length === 0 ? <li>{t("No progress yet.")}</li> : null}
        </ol>
      ) : null}
    </li>
  );
}

function TasksTab({ threadId }: { threadId: string }) {
  const t = useExtracted();
  const jobs = useThreadJobs(threadId);
  if (jobs.isLoading) return <Spinner className="size-4" />;
  if (!jobs.data?.jobs.length)
    return (
      <p className="text-sm text-muted-foreground">{t("No tasks in this conversation yet.")}</p>
    );
  return (
    <ul className="divide-y rounded-lg border">
      {jobs.data.jobs.map((job) => (
        <JobRow key={job.id} job={job} />
      ))}
    </ul>
  );
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const t = useExtracted();
  const [preview, setPreview] = useState<string | null>(null);
  const errorText = useRunErrorText();
  const load = useMutation({
    mutationFn: () => runFetch<{ content: string }>(`artifacts/${artifact.id}`),
    onSuccess: (result) => setPreview(result.content),
    onError: (error) => toast.error(errorText(error)),
  });
  const textual =
    artifact.mimeType.startsWith("text/") || /json|markdown|csv/.test(artifact.mimeType);
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{artifact.title}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{artifact.path}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {textual ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={load.isPending}
              onClick={() => (preview === null ? load.mutate() : setPreview(null))}
            >
              {preview === null ? t("Preview") : t("Hide")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            render={<a href={`/api/run/artifacts/${artifact.id}?mode=download`} download />}
            nativeButton={false}
          >
            <Download className="size-3" />
            {t("Download")}
          </Button>
        </div>
      </div>
      {artifact.description ? (
        <p className="text-xs text-muted-foreground">{artifact.description}</p>
      ) : null}
      {preview !== null ? (
        <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
          {preview}
        </pre>
      ) : null}
    </li>
  );
}

function DeliverablesTab({ threadId }: { threadId: string }) {
  const t = useExtracted();
  const artifacts = useThreadArtifacts(threadId);
  if (artifacts.isLoading) return <Spinner className="size-4" />;
  if (!artifacts.data?.artifacts.length)
    return (
      <p className="text-sm text-muted-foreground">
        {t("Files a teammate delivers in this conversation appear here.")}
      </p>
    );
  return (
    <ul className="flex flex-col gap-2">
      {artifacts.data.artifacts.map((artifact) => (
        <ArtifactCard key={artifact.id} artifact={artifact} />
      ))}
    </ul>
  );
}

type ComputerResponse = {
  capabilities: RunCapabilities | null;
  liveViewUrl: string | null;
  computer: { status: string; workingLabel: string; url: string | null; lastError: string | null };
};

/**
 * The shared computer: the browser's live view when a browser provider is configured
 * (a person can take over there for logins and CAPTCHAs), otherwise a clear disabled state.
 */
export function ComputerPanel({ jobId }: { jobId?: string }) {
  const t = useExtracted();
  const errorText = useRunErrorText();
  const computer = useQuery({
    queryKey: runKeys.computer(jobId),
    queryFn: () =>
      runFetch<ComputerResponse>(`computer${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ""}`),
    refetchInterval: 5_000,
  });
  const release = useMutation({
    mutationFn: () => runFetch("computer", { body: { action: "release", jobId } }),
    onSuccess: () => computer.refetch(),
    onError: (error) => toast.error(errorText(error)),
  });
  if (computer.isLoading) return <Spinner className="size-4" />;
  if (computer.isError)
    return <p className="text-sm text-destructive">{errorText(computer.error)}</p>;
  const data = computer.data!;
  const capabilities = data.capabilities;
  if (!capabilities?.browser && !capabilities?.sandbox) {
    return (
      <Alert>
        <MonitorOff className="size-4" />
        <AlertTitle>{t("The computer is not available")}</AlertTitle>
        <AlertDescription>
          {t(
            "No browser or sandbox provider is configured for Run on this server, so teammates work without a computer.",
          )}
        </AlertDescription>
      </Alert>
    );
  }
  const takeover = data.computer.status === "takeover";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate text-muted-foreground">
          {data.computer.workingLabel || data.computer.url || t("Idle")}
        </span>
        <div className="flex gap-1">
          {data.liveViewUrl ? (
            <Button
              size="sm"
              variant={takeover ? "default" : "outline"}
              render={<a href={data.liveViewUrl} target="_blank" rel="noreferrer" />}
              nativeButton={false}
            >
              <MousePointerClick className="size-3" />
              {t("Take control")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={release.isPending}
            onClick={() => release.mutate()}
          >
            {t("Close browser")}
          </Button>
        </div>
      </div>
      {takeover ? (
        <Alert>
          <AlertTitle>{t("Your turn")}</AlertTitle>
          <AlertDescription>
            {t(
              "Finish the step in the browser (for example a login), then send a message to continue.",
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {data.liveViewUrl ? (
        <iframe
          title={t("Live view of the teammate's browser")}
          src={data.liveViewUrl}
          className="aspect-[16/10] w-full rounded-lg border bg-muted"
          sandbox="allow-scripts allow-same-origin"
        />
      ) : capabilities.browser ? (
        <p className="text-sm text-muted-foreground">{t("The browser has not started yet.")}</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("No browser provider is configured; only the terminal and files are available.")}
        </p>
      )}
      {data.computer.lastError ? (
        <p className="text-xs text-destructive">{data.computer.lastError}</p>
      ) : null}
    </div>
  );
}

/** Tasks, deliverables and the computer for one conversation. */
export function RunWorkspacePanel({ threadId, jobId }: { threadId: string; jobId?: string }) {
  const t = useExtracted();
  return (
    <Tabs defaultValue="tasks" className="flex flex-col gap-3">
      <TabsList>
        <TabsTrigger value="tasks">{t("Tasks")}</TabsTrigger>
        <TabsTrigger value="deliverables">{t("Deliverables")}</TabsTrigger>
        <TabsTrigger value="computer">{t("Computer")}</TabsTrigger>
      </TabsList>
      <TabsContent value="tasks">
        <TasksTab threadId={threadId} />
      </TabsContent>
      <TabsContent value="deliverables">
        <DeliverablesTab threadId={threadId} />
      </TabsContent>
      <TabsContent value="computer">
        <ComputerPanel jobId={jobId} />
      </TabsContent>
    </Tabs>
  );
}
