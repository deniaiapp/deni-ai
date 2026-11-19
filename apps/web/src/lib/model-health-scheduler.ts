import * as Sentry from "@sentry/tanstackstart-react";
import { checkModelHealth, type ModelHealthResult } from "@/lib/model-health";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 10_000;

const globalForScheduler = globalThis as typeof globalThis & {
  modelHealthSchedulerStarted?: boolean;
};

const lastErrors = new Map<string, string | null>();

/**
 * Logs a probe failure when it first appears or its error changes, so the reason a
 * model shows as unavailable can be read without calling the cron route, and logs
 * a recovery once. Sentry gets one report per outage, when the failure first
 * appears: provider errors (a quota message, for one) vary from probe to probe and
 * would otherwise send a new report every 5 minutes.
 */
export function reportModelHealthChanges(results: ModelHealthResult[]) {
  for (const result of results) {
    const previous = lastErrors.get(result.model);
    lastErrors.set(result.model, result.error);
    if (result.error === (previous ?? null)) continue;
    if (result.error) {
      console.warn(`[model-health] ${result.model} (${result.provider}) failed: ${result.error}`);
      if (previous) continue;
      Sentry.captureMessage(`Model health probe failed: ${result.model}`, {
        level: "warning",
        tags: { model: result.model, provider: result.provider },
        extra: { error: result.error },
      });
    } else if (previous) {
      console.info(`[model-health] ${result.model} (${result.provider}) recovered`);
    }
  }
}

async function runCheck() {
  try {
    reportModelHealthChanges(await checkModelHealth());
  } catch (error) {
    Sentry.captureException(error);
  }
}

/**
 * Probes the monitored models in-process every 5 minutes. Meant for a long-running
 * server (Docker / Dokploy); with several replicas each one probes on its own (a
 * few extra tokens). Serverless hosts schedule `/api/cron/model-health` instead.
 */
export function startModelHealthScheduler() {
  if (globalForScheduler.modelHealthSchedulerStarted) return;
  globalForScheduler.modelHealthSchedulerStarted = true;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runCheck();
    } finally {
      running = false;
    }
  };

  setTimeout(tick, FIRST_CHECK_DELAY_MS).unref();
  setInterval(tick, CHECK_INTERVAL_MS).unref();
}
