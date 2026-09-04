import type { RunMode } from "./model";

export type BotStatus = "idle" | "working" | "waiting";

export type Bot = {
  id: string;
  name: string;
  job: string;
  instructions: string;
  accent: string;
  createdAt: string;
  updatedAt: string;
  memory: MemoryEntry[];
};

export type MemoryEntry = {
  id: string;
  text: string;
  createdAt: string;
};

export type ThreadKind = "dm" | "group";

export type Thread = {
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
  activity: ComputerActivity[];
};

export type AppConfig = {
  apiKey: string;
  timezone: string;
  model: string;
  runMode?: RunMode;
};

export type PlanId = "free" | "pro";

export type Billing = {
  plan: PlanId;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeStatus: string | null;
  currentPeriodEnd: string | null;
};

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
