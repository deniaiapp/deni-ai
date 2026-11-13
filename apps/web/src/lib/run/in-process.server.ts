import { env } from "@/env";
import {
  ensureRunConfigured,
  setRunNotificationHook,
  stopInProcessScheduler,
} from "@/lib/run/runtime.server";
import { onShutdown } from "@/lib/shutdown.server";

/**
 * Runs Deni Run's background work inside the web server instead of the
 * `@deniai/run-worker` service, with `RUN_SCHEDULER_IN_PROCESS=true`:
 *
 * - the job scheduler (stale-lease recovery, due routines, claiming), started at boot;
 * - with `RUN_DISCORD_ENABLED=true` and `DISCORD_BOT_TOKEN`, the Discord bot and its DMs.
 *
 * On graceful shutdown (Nitro `close` hook) the scheduler stops claiming and waits for
 * running jobs up to `RUN_SHUTDOWN_TIMEOUT_MS` (default 8 s: minidock stops an old
 * container with a 10 s grace period), then the bot disconnects.
 *
 * Only for a deployment with one web instance: two schedulers are safe (claims use
 * `FOR UPDATE SKIP LOCKED`, routine runs have idempotency keys), but two bots on one
 * token would both answer. Deploys briefly overlap the old and new container.
 */

export const DEFAULT_RUN_SHUTDOWN_TIMEOUT_MS = 8_000;

type Logger = Pick<Console, "info" | "warn" | "error">;

export type InProcessRunPlan = {
  scheduler: boolean;
  discordToken: string | null;
  shutdownTimeoutMs: number;
};

/** What to start, from the environment; `scheduler: false` means nothing runs here. */
export function inProcessRunPlan(source: {
  runEnabled: boolean;
  schedulerInProcess: string | undefined;
  discordEnabled: boolean;
  discordToken: string | undefined;
  shutdownTimeoutMs: string | undefined;
}): InProcessRunPlan {
  const scheduler = source.runEnabled && source.schedulerInProcess === "true";
  const token = source.discordToken?.trim() || null;
  const timeout = Number(source.shutdownTimeoutMs?.trim() || Number.NaN);
  return {
    scheduler,
    discordToken: scheduler && source.discordEnabled ? token : null,
    shutdownTimeoutMs:
      Number.isFinite(timeout) && timeout >= 0 ? timeout : DEFAULT_RUN_SHUTDOWN_TIMEOUT_MS,
  };
}

export async function startInProcessRun(logger: Logger = console) {
  const plan = inProcessRunPlan({
    runEnabled: env.RUN_ENABLED,
    schedulerInProcess: env.RUN_SCHEDULER_IN_PROCESS,
    discordEnabled: env.RUN_DISCORD_ENABLED,
    discordToken: env.DISCORD_BOT_TOKEN,
    shutdownTimeoutMs: env.RUN_SHUTDOWN_TIMEOUT_MS,
  });
  if (!plan.scheduler) return;

  // Imported only when the bot runs, so discord.js stays unloaded otherwise.
  const push = plan.discordToken ? await import("@deniai/run/discord/push") : null;
  if (push) {
    setRunNotificationHook(async (notification) => {
      await push.pushNotificationToDiscord(notification.userId, notification);
    });
  }
  const setup = ensureRunConfigured();
  if (!setup.ok) {
    logger.error("[run] in-process worker not started:", setup.message);
    return;
  }
  onShutdown("run scheduler", () => stopInProcessScheduler(plan.shutdownTimeoutMs, logger));

  if (plan.discordToken) {
    const { startDiscordBot } = await import("@deniai/run/discord/bot");
    const bot = startDiscordBot(plan.discordToken);
    onShutdown("run discord bot", () => bot.stop());
    logger.info("[run] in-process Discord bot started");
  }
}
