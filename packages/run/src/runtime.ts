import { createHash } from "node:crypto";
import type { LanguageModel } from "ai";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { BrowserProvider, SandboxProvider } from "./computer/providers";

/**
 * Host wiring for `@deniai/run`. Packages never import an app, so the web app and the
 * worker call {@link configureRun} once at startup with their database, usage engine
 * binding and environment; every module reads them through {@link runDeps}.
 */

// oxlint-disable-next-line no-explicit-any
export type RunDatabase = PgDatabase<PgQueryResultHKT, any, any>;

export type RunLogger = Pick<Console, "error" | "warn" | "info">;

/** Configuration read from the host's environment (see {@link loadRunConfig}). */
export type RunConfig = {
  /** 32-byte AES-256-GCM key for Run secrets (MCP credentials, BYOK keys). */
  encryptionKey: Buffer;
  /** Platform OpenRouter key; users may bring their own when unset. */
  openrouterApiKey: string | null;
  exaApiKey: string | null;
  /** OAuth client of the Slack MCP connector (Slack has no dynamic client registration). */
  slackMcp: { clientId: string; clientSecret: string | null } | null;
  e2b: { apiKey: string; timeoutMs: number | null; idleMs: number | null } | null;
  steel: {
    apiKey: string;
    baseUrl: string | null;
    sessionTimeoutMs: number | null;
    sessionIdleMs: number | null;
  } | null;
  s3: {
    endpoint: string | null;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    forcePathStyle: boolean;
  } | null;
  /** Provider cost of browser (Steel) and computer (E2B) time, USD per hour. */
  browserUsdPerHour: number;
  computerUsdPerHour: number;
  schedulerConcurrency: number;
  /** Local directory for workspace mirrors and screenshots when object storage is off. */
  localDataDir: string;
  /** Public origin of the web app (links in notifications and Discord replies). */
  appUrl: string;
  production: boolean;
};

/** What Run needs from the shared usage engine (`@deniai/billing/server`). */
export type RunUsageBinding = {
  /** The plan's shared monthly pool as Run sees it, in USD. */
  getRunBudget(userId: string): Promise<RunBudget>;
  /** Add incurred Run cost to the product ledger (`product_usage`, product `run`). */
  recordRunCost(input: { userId: string; metric: RunCostMetric; costUsd: number }): Promise<void>;
};

export type RunCostMetric = "model" | "browser" | "computer";

export type RunBudget = {
  tier: "free" | "go" | "plus" | "pro";
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
  periodEnd: Date;
  poolUsd: { chat: number; flixa: number; run: number };
};

export type RunDeps = {
  db: RunDatabase;
  usage: RunUsageBinding;
  config: RunConfig;
  logger?: RunLogger;
  /**
   * Override the computer providers (tests). `null` turns one off; undefined uses the
   * configuration (E2B / Steel keys).
   */
  computer?: { sandbox?: SandboxProvider | null; browser?: BrowserProvider | null };
  /** Override the language model (tests); default: OpenRouter with the platform or user key. */
  languageModel?: (modelId: string) => LanguageModel;
  /** Called with every new notification (the worker pushes them to Discord). */
  onNotification?(notification: {
    userId: string;
    jobId: string | null;
    kind: string;
    title: string;
    body: string;
  }): void | Promise<void>;
};

const g = globalThis as typeof globalThis & { __deniRunDeps?: RunDeps };

export function configureRun(deps: RunDeps) {
  g.__deniRunDeps = deps;
}

export function isRunConfigured() {
  return Boolean(g.__deniRunDeps);
}

export function runDeps(): RunDeps {
  const deps = g.__deniRunDeps;
  if (!deps) throw new Error("Deni Run is not configured: call configureRun() first.");
  return deps;
}

export function runConfig(): RunConfig {
  return runDeps().config;
}

export function runLogger(): RunLogger {
  return runDeps().logger ?? console;
}

/**
 * The configured database. Modules import `db` and use it like a Drizzle instance;
 * every property read is forwarded to the database passed to {@link configureRun}.
 */
export const db: RunDatabase = new Proxy({} as RunDatabase, {
  get(_target, property) {
    const real = runDeps().db as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(real, property);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
});

type Env = Record<string, string | undefined>;

function value(env: Env, name: string) {
  const raw = env[name]?.trim();
  return raw ? raw : null;
}

function positiveNumber(env: Env, name: string, fallback: number | null) {
  const raw = value(env, name);
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * The Run key: `RUN_ENCRYPTION_KEY` (32 bytes, base64) or, when unset, a key derived
 * from the platform's `BETTER_AUTH_SECRET` so a deployment needs no extra secret.
 */
export function runEncryptionKey(env: Env): Buffer {
  const explicit = value(env, "RUN_ENCRYPTION_KEY");
  if (explicit) {
    const key = Buffer.from(explicit, "base64");
    if (key.length !== 32) throw new Error("RUN_ENCRYPTION_KEY must decode to 32 bytes");
    return key;
  }
  const secret = value(env, "BETTER_AUTH_SECRET");
  if (!secret) throw new Error("RUN_ENCRYPTION_KEY or BETTER_AUTH_SECRET is required");
  return createHash("sha256").update(`deni-run:v1:${secret}`).digest();
}

/** Read Run's configuration from environment variables (`process.env` of the host). */
export function loadRunConfig(env: Env, options?: { localDataDir?: string }): RunConfig {
  const e2bKey = value(env, "E2B_API_KEY");
  const steelKey = value(env, "STEEL_API_KEY");
  const s3Bucket = value(env, "RUN_S3_BUCKET");
  const s3Key = value(env, "RUN_S3_ACCESS_KEY_ID");
  const s3Secret = value(env, "RUN_S3_SECRET_ACCESS_KEY");
  const concurrency = positiveNumber(env, "RUN_SCHEDULER_CONCURRENCY", 4) ?? 4;
  return {
    encryptionKey: runEncryptionKey(env),
    openrouterApiKey: value(env, "OPENROUTER_API_KEY"),
    exaApiKey: value(env, "EXA_API_KEY"),
    slackMcp: value(env, "SLACK_MCP_CLIENT_ID")
      ? {
          clientId: value(env, "SLACK_MCP_CLIENT_ID")!,
          clientSecret: value(env, "SLACK_MCP_CLIENT_SECRET"),
        }
      : null,
    e2b: e2bKey
      ? {
          apiKey: e2bKey,
          timeoutMs: positiveNumber(env, "E2B_SANDBOX_TIMEOUT_MS", null),
          idleMs: positiveNumber(env, "E2B_SANDBOX_IDLE_MS", null),
        }
      : null,
    steel: steelKey
      ? {
          apiKey: steelKey,
          baseUrl: value(env, "STEEL_BASE_URL"),
          sessionTimeoutMs: positiveNumber(env, "STEEL_SESSION_TIMEOUT_MS", null),
          sessionIdleMs: positiveNumber(env, "STEEL_SESSION_IDLE_MS", null),
        }
      : null,
    s3:
      s3Bucket && s3Key && s3Secret
        ? {
            endpoint: value(env, "RUN_S3_ENDPOINT"),
            region: value(env, "RUN_S3_REGION") ?? "auto",
            accessKeyId: s3Key,
            secretAccessKey: s3Secret,
            bucket: s3Bucket,
            forcePathStyle: value(env, "RUN_S3_FORCE_PATH_STYLE") === "true",
          }
        : null,
    browserUsdPerHour: positiveNumber(env, "RUN_BROWSER_USD_PER_HOUR", 0.1) ?? 0.1,
    computerUsdPerHour: positiveNumber(env, "RUN_COMPUTER_USD_PER_HOUR", 0.15) ?? 0.15,
    schedulerConcurrency: Math.min(Math.max(Math.floor(concurrency), 1), 16),
    localDataDir: options?.localDataDir ?? value(env, "RUN_LOCAL_DATA_DIR") ?? ".deni",
    appUrl:
      value(env, "BETTER_AUTH_URL") ??
      value(env, "NEXT_PUBLIC_BETTER_AUTH_URL") ??
      "http://localhost:3000",
    production: env.NODE_ENV === "production",
  };
}

/** Which optional providers are configured; the UI shows a disabled state for the rest. */
export function runCapabilities(config: RunConfig = runConfig()) {
  return {
    llm: Boolean(config.openrouterApiKey),
    webSearch: Boolean(config.exaApiKey),
    sandbox: Boolean(config.e2b),
    browser: Boolean(config.steel),
    objectStorage: Boolean(config.s3),
  };
}

export type RunCapabilities = ReturnType<typeof runCapabilities>;
