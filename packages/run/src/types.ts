import type { RunMode } from "./agent/model";

export type BotStatus = "idle" | "working" | "waiting";

export type Bot = {
  icon?: string | null;
  id: string;
  name: string;
  job: string;
  instructions: string;
  accent: string;
  createdAt: string;
  updatedAt: string;
  memory: MemoryEntry[];
  /** Tool groups the teammate may use; null or undefined: all (see TEAMMATE_TOOL_GROUPS). */
  tools?: string[] | null;
  /** Whether the teammate may use the shared computer. Undefined means yes. */
  computerAccess?: boolean;
};

export type MemoryEntry = {
  id: string;
  text: string;
  createdAt: string;
};

export type ThreadKind = "dm" | "group";

export type Thread = {
  icon?: string | null;
  reactions?: Record<string, string[]>;
  id: string;
  kind: ThreadKind;
  title: string;
  botIds: string[];
  createdAt: string;
  updatedAt: string;
  lastPreview: string;
  pinned?: boolean;
  unread?: boolean;
  hidden?: boolean;
  section?: string | null;
};

export type Skill = {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type Routine = {
  revision?: number;
  id: string;
  botId: string;
  threadId: string;
  name: string;
  instructions: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  createdAt: string;
  /** Language of the person who last saved the routine; background runs write in it. */
  locale?: string;
};

export type ComputerActivity = {
  at: string;
  botId: string | null;
  kind: "shell" | "files" | "browser" | "system";
  title: string;
  detail: string;
};

export type ComputerState = {
  status: "idle" | "working" | "takeover" | "error";
  workingBotId: string | null;
  /** Job that currently owns the account-level computer indicator, if any. */
  activeJobId?: string | null;
  workingLabel: string;
  url: string | null;
  title: string | null;
  lastCommand: string | null;
  lastError: string | null;
  screenshotAt: string | null;
  e2bSandboxId: string | null;
  steelSessionId: string | null;
  steelProfileId: string | null;
  steelDebugUrl: string | null;
  browserLive?: boolean;
  sandboxLive?: boolean;
  /** Which providers this deployment has; the UI disables the computer panel without them. */
  capabilities?: { browser: boolean; sandbox: boolean; files: boolean };
  /** Per-job browser/workspace state. The account still owns the underlying profile and files. */
  workspaces?: Record<string, ComputerWorkspaceState>;
  activity: ComputerActivity[];
};

export type ComputerWorkspaceState = {
  jobId: string;
  botId: string | null;
  status: "idle" | "working" | "takeover" | "error";
  workingLabel: string;
  url: string | null;
  title: string | null;
  lastError: string | null;
  updatedAt: string;
};

export type AppConfig = {
  apiKey: string;
  timezone: string;
  model: string;
  runMode?: RunMode;
};

/**
 * Legacy Deni Run Stripe billing. Plans now come from Deni AI; old stores keep
 * these fields so former subscriptions can still be found and cancelled.
 */
export type Billing = {
  plan: "free" | "pro";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeStatus: string | null;
  currentPeriodEnd: string | null;
};

/** Legacy local usage counters; usage is now metered by Deni AI. */
export type UsagePeriod = {
  month: string;
  tokens: number;
  messages?: number;
  browserMs: number;
  computerMs: number;
};

export type HandoffStep = {
  kind: "thinking" | "tool";
  label: string;
  detail?: string;
  status: "active" | "complete";
};

export type HandoffSnapshot = {
  id: string;
  fromBotId: string;
  fromBotName: string;
  targetBotId: string;
  targetName: string;
  threadId: string;
  status: "running" | "done" | "error";
  currentLabel: string;
  steps: HandoffStep[];
  reply: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
};

export type JobStatus =
  | "queued"
  | "running"
  | "finalizing"
  | "waiting_approval"
  | "waiting_takeover"
  | "paused"
  | "uncertain"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentJob = {
  id: string;
  userId?: string;
  threadId: string;
  botId: string;
  kind: "chat" | "routine" | "handoff" | "retry";
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  checkpoint: Record<string, unknown> | null;
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string;
  error: string | null;
  lockedAt: string | null;
  heartbeatAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobEvent = {
  id: string;
  jobId: string;
  kind: string;
  payload: Record<string, unknown>;
  sequence: number;
  createdAt: string;
};

export type Artifact = {
  id: string;
  jobId: string | null;
  threadId: string;
  botId: string | null;
  path: string;
  title: string;
  mimeType: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotificationKind = "completed" | "failed" | "approval" | "takeover" | "info";

export type AppNotification = {
  id: string;
  jobId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export type McpConnection = {
  id: string;
  name: string;
  url: string;
  transport: "streamable-http" | "sse";
  enabled: boolean;
  /** Connector catalog entry, or null for a custom server. */
  catalogId: string | null;
  hasSecret: boolean;
  /** OAuth sign-in state; null when the server does not use OAuth. */
  oauth: "signed-in" | "signed-out" | null;
  headerNames: string[];
  lastTestAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Store = {
  version: 1;
  config: AppConfig;
  bots: Bot[];
  threads: Thread[];
  skills: Skill[];
  routines: Routine[];
  computer: ComputerState;
  shells: ShellRecord[];
  handoffs?: HandoffSnapshot[];
  billing?: Billing;
  usage?: UsagePeriod;
  /** Runtime state is persisted separately; these optional fields preserve old callers. */
  jobs?: AgentJob[];
  artifacts?: Artifact[];
  notifications?: AppNotification[];
  mcpConnections?: McpConnection[];
  pluginAlwaysAllow?: Record<string, boolean>;
  /** MCP tools that run without approval, keyed `${connectionId}:${toolName}`. */
  mcpAlwaysAllow?: Record<string, boolean>;
  /** Rolling summaries of the history each thread no longer sends to the model, by thread id. */
  historySummaries?: Record<string, HistorySummary>;
  /** Discord preferences of the linked account. The link itself lives in discord_links. */
  discord?: DiscordPrefs;
};

export type DiscordPrefs = {
  /** Group conversation plain DMs go to. Null or a deleted group means the chosen teammate's DM. */
  threadId?: string | null;
  /** DM the person when background work finishes, fails, or needs them. On unless turned off. */
  notify?: boolean;
};

export type HistorySummary = {
  /** Last message the summary covers; anything after it is folded in on the next request. */
  throughMessageId: string;
  text: string;
  updatedAt: string;
};

export type WorkspaceNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  children?: WorkspaceNode[];
};

export type ShellRecord = {
  id: string;
  at: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};
