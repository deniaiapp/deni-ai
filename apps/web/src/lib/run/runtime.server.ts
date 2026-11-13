import {
  configureRun,
  isRunConfigured,
  loadRunConfig,
  runCapabilities,
  type RunDeps,
} from "@deniai/run";
import { runUsageBinding } from "@deniai/run/usage-binding";
import { db } from "@/db/drizzle";
import { getRunBudget, recordRunCost } from "@/lib/usage";

/**
 * Binds `@deniai/run` to this app: its database, the shared usage engine and the
 * environment (`loadRunConfig(process.env)`). Called by every Run API handler; the
 * first call configures the process. With `RUN_SCHEDULER_IN_PROCESS=true` the Run job
 * scheduler also runs here (started at boot by `src/lib/run/in-process.server.ts`, or by
 * the first Run request); otherwise the `@deniai/run-worker` service runs it.
 */

const globalForRun = globalThis as typeof globalThis & {
  deniRunWebConfigured?: boolean;
  deniRunWebSchedulerStop?: (() => Promise<void> | void) | null;
  deniRunWebNotify?: RunDeps["onNotification"];
};

/**
 * Where Run sends a user's notifications besides the database (the in-process Discord
 * bot's DMs). Set before the first {@link ensureRunConfigured}; a later call reconfigures.
 */
export function setRunNotificationHook(hook: RunDeps["onNotification"]) {
  globalForRun.deniRunWebNotify = hook;
  globalForRun.deniRunWebConfigured = false;
}

export type RunSetup = { ok: true } | { ok: false; reason: "config_error"; message: string };

export function ensureRunConfigured(): RunSetup {
  if (globalForRun.deniRunWebConfigured && isRunConfigured()) return { ok: true };
  let config: ReturnType<typeof loadRunConfig>;
  try {
    config = loadRunConfig(process.env);
  } catch (error) {
    return {
      ok: false,
      reason: "config_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  configureRun({
    db,
    usage: runUsageBinding({ getRunBudget, recordRunCost }),
    config,
    logger: console,
    onNotification: globalForRun.deniRunWebNotify,
  });
  globalForRun.deniRunWebConfigured = true;
  if (process.env.RUN_SCHEDULER_IN_PROCESS === "true" && !globalForRun.deniRunWebSchedulerStop) {
    void startInProcessScheduler();
  }
  return { ok: true };
}

/**
 * Stops claiming jobs and waits for the running ones, at most `timeoutMs`. A job cut
 * off keeps its lease; the next scheduler marks it `uncertain` once the lease expires.
 */
export async function stopInProcessScheduler(
  timeoutMs: number,
  logger: Pick<Console, "info" | "warn"> = console,
) {
  const stop = globalForRun.deniRunWebSchedulerStop;
  if (!stop) return;
  globalForRun.deniRunWebSchedulerStop = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    Promise.resolve(stop()).then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
  if (timedOut) logger.warn("[run] running jobs did not finish before the shutdown timeout");
  else logger.info("[run] in-process scheduler stopped");
}

async function startInProcessScheduler() {
  globalForRun.deniRunWebSchedulerStop = () => undefined;
  try {
    const { startScheduler } = await import("@deniai/run/jobs/scheduler");
    globalForRun.deniRunWebSchedulerStop = startScheduler();
    console.info("[run] in-process scheduler started");
  } catch (error) {
    globalForRun.deniRunWebSchedulerStop = null;
    console.error("[run] in-process scheduler failed to start", error);
  }
}

/** Which providers are configured (the UI shows a disabled state for the rest). */
export function runStatus() {
  const setup = ensureRunConfigured();
  if (!setup.ok) return { configured: false as const, capabilities: null };
  return { configured: true as const, capabilities: runCapabilities() };
}
