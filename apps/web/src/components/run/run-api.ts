import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentJob,
  AppNotification,
  Artifact,
  Bot,
  ComputerState,
  JobEvent,
  McpConnection,
  Routine,
  Skill,
  Thread,
} from "@deniai/run/types";
import type { UIMessage } from "ai";

/** Client side of the Run API (`/api/run/*`, src/server/http/run/router.ts). */

export type { AgentJob, AppNotification, Artifact, Bot, McpConnection, Routine, Skill, Thread };

export type RunCapabilities = {
  llm: boolean;
  webSearch: boolean;
  sandbox: boolean;
  browser: boolean;
  objectStorage: boolean;
};

export type RunStatus = { configured: boolean; capabilities: RunCapabilities | null };

export type RunUsage = {
  plan: string;
  planName: string;
  pool: { usedPercent: number; parts: { chat: number; flixa: number; run: number } };
  teammates: { used: number; limit: number };
  manageUrl: string;
} | null;

export type RunState = {
  ready: boolean;
  capabilities: RunCapabilities | null;
  timezone: string;
  runMode: string;
  bots: Bot[];
  threads: Thread[];
  skills: Skill[];
  routines: Routine[];
  computer: ComputerState;
  usage: RunUsage;
  teammateLimit: { tier: string; limit: number };
  unreadNotifications: number;
  jobs: AgentJob[];
};

/** A failed Run API call: `code` is the server's error code (see runErrorText). */
export class RunApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "RunApiError";
  }
}

export async function runFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`/api/run/${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    throw new RunApiError(
      response.status,
      typeof body.error === "string" ? body.error : `http_${response.status}`,
      body,
    );
  }
  return (await response.json()) as T;
}

export const runKeys = {
  status: ["run", "status"] as const,
  state: ["run", "state"] as const,
  thread: (id: string) => ["run", "thread", id] as const,
  jobs: (threadId: string) => ["run", "jobs", threadId] as const,
  job: (id: string) => ["run", "job", id] as const,
  artifacts: (threadId: string) => ["run", "artifacts", threadId] as const,
  notifications: ["run", "notifications"] as const,
  computer: (jobId: string | undefined) => ["run", "computer", jobId ?? ""] as const,
  mcp: ["run", "mcp"] as const,
  discord: ["run", "discord"] as const,
};

export function useRunStatus() {
  return useQuery({
    queryKey: runKeys.status,
    queryFn: () => runFetch<RunStatus>("status"),
    staleTime: 5 * 60_000,
  });
}

export function useRunState(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: runKeys.state,
    queryFn: () => runFetch<RunState>("state"),
    staleTime: 15_000,
    enabled: options.enabled,
  });
}

export function useRunThread(id: string) {
  return useQuery({
    queryKey: runKeys.thread(id),
    queryFn: () => runFetch<{ thread: Thread; messages: UIMessage[] }>(`threads/${id}`),
    staleTime: 0,
  });
}

export function useThreadJobs(threadId: string) {
  return useQuery({
    queryKey: runKeys.jobs(threadId),
    queryFn: () =>
      runFetch<{ jobs: AgentJob[] }>(`jobs?threadId=${encodeURIComponent(threadId)}&limit=20`),
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) => ["queued", "running", "finalizing"].includes(job.status))
        ? 3_000
        : false,
  });
}

export function useJobEvents(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: runKeys.job(jobId),
    queryFn: () => runFetch<{ job: AgentJob; events: JobEvent[] }>(`jobs/${jobId}`),
    enabled,
  });
}

export function useThreadArtifacts(threadId: string) {
  return useQuery({
    queryKey: runKeys.artifacts(threadId),
    queryFn: () =>
      runFetch<{ artifacts: Artifact[] }>(`artifacts?threadId=${encodeURIComponent(threadId)}`),
  });
}

export function useRunNotifications() {
  return useQuery({
    queryKey: runKeys.notifications,
    queryFn: () => runFetch<{ notifications: AppNotification[] }>("notifications"),
  });
}

export function useInvalidateRun() {
  const queryClient = useQueryClient();
  return (key: readonly unknown[] = ["run"]) => queryClient.invalidateQueries({ queryKey: key });
}

/** Display name of a teammate list for a thread. */
export function threadTeammates(state: RunState | undefined, thread: Thread | undefined) {
  if (!state || !thread) return [];
  return thread.botIds
    .map((id) => state.bots.find((bot) => bot.id === id))
    .filter((bot): bot is Bot => Boolean(bot));
}
