import { configureRun, isRunConfigured, loadRunConfig, runCapabilities } from "@deniai/run";
import { runUsageBinding } from "@deniai/run/usage-binding";
import { db } from "@/db/drizzle";
import { getRunBudget, recordRunCost } from "@/lib/usage";

/**
 * Binds `@deniai/run` to this app: its database, the shared usage engine and the
 * environment (`loadRunConfig(process.env)`). Called by every Run API handler; the
 * first call configures the process. With `RUN_SCHEDULER_IN_PROCESS=true` (local
 * development) the Run job scheduler also runs here; in production the
 * `@deniai/run-worker` service runs it.
 */

const globalForRun = globalThis as typeof globalThis & {
  deniRunWebConfigured?: boolean;
  deniRunWebSchedulerStop?: (() => Promise<void> | void) | null;
};

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
  });
  globalForRun.deniRunWebConfigured = true;
  if (process.env.RUN_SCHEDULER_IN_PROCESS === "true" && !globalForRun.deniRunWebSchedulerStop) {
    void startInProcessScheduler();
  }
  return { ok: true };
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
