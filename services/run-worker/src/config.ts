/** What the worker process runs, read from its environment. */
export type WorkerConfig = {
  databaseUrl: string;
  /** Run the job scheduler (default on; `RUN_SCHEDULER_ENABLED=false` turns it off). */
  scheduler: boolean;
  /** Discord bot settings; null unless `RUN_DISCORD_ENABLED=true` and a bot token is set. */
  discord: { token: string; inviteUrl: string | null } | null;
  /** How long a shutdown waits for running jobs before closing the pool. */
  shutdownTimeoutMs: number;
};

type Env = Record<string, string | undefined>;

function value(env: Env, name: string) {
  const raw = env[name]?.trim();
  return raw ? raw : null;
}

function flag(env: Env, name: string, fallback: boolean) {
  const raw = value(env, name)?.toLowerCase();
  if (raw === undefined || raw === null) return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

export function readWorkerConfig(env: Env): WorkerConfig {
  const databaseUrl = value(env, "DATABASE_URL") ?? value(env, "DENI_DATABASE_URL");
  if (!databaseUrl) throw new Error("DATABASE_URL (or DENI_DATABASE_URL) is required");
  const token = value(env, "DISCORD_BOT_TOKEN");
  const timeout = Number(value(env, "RUN_SHUTDOWN_TIMEOUT_MS") ?? Number.NaN);
  return {
    databaseUrl,
    scheduler: flag(env, "RUN_SCHEDULER_ENABLED", true),
    discord:
      flag(env, "RUN_DISCORD_ENABLED", false) && token
        ? { token, inviteUrl: value(env, "DISCORD_INVITE_URL") }
        : null,
    shutdownTimeoutMs: Number.isFinite(timeout) && timeout >= 0 ? timeout : 60_000,
  };
}

/** Startup summary without secrets (no URLs with credentials, no tokens). */
export function describeWorkerConfig(config: WorkerConfig) {
  let database = "unparseable";
  try {
    const url = new URL(config.databaseUrl);
    database = `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
  } catch {
    // keep "unparseable"
  }
  return {
    database,
    scheduler: config.scheduler,
    discord: Boolean(config.discord),
    shutdownTimeoutMs: config.shutdownTimeoutMs,
  };
}
