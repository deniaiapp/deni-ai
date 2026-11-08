import { createUsageEngine } from "@deniai/billing/server";
import { configureRun, loadRunConfig, runCapabilities } from "@deniai/run";
import { runUsageBinding } from "@deniai/run/usage-binding";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describeWorkerConfig, readWorkerConfig } from "./config";
import { createWorker } from "./lifecycle";
import { startRunScheduler } from "./scheduler";

/**
 * Deni Run worker: the job scheduler and, behind `RUN_DISCORD_ENABLED=true`, the
 * Discord bot. Env comes from the process (`--env-file-if-exists=.env` in the scripts).
 */
async function main() {
  const logger = console;
  const config = readWorkerConfig(process.env);
  const client = postgres(config.databaseUrl, {
    max: 8,
    idle_timeout: 0,
    connect_timeout: 10,
    // Compatible with PgBouncer / Neon pooler URLs.
    prepare: false,
  });
  const db = drizzle({ client });
  const engine = createUsageEngine({
    db,
    logger,
    // The web app's usage job recovers unsettled reservations; Run records cost directly.
    scheduleRecovery: (at) =>
      logger.warn("[run worker] usage recovery requested", { at: new Date(at).toISOString() }),
  });
  const runConfig = loadRunConfig(process.env);
  const discord = config.discord ? await import("./discord/bot") : null;
  const push = config.discord ? await import("./discord/push") : null;
  configureRun({
    db,
    usage: runUsageBinding(engine),
    config: runConfig,
    logger,
    onNotification: push
      ? async (notification) => {
          await push.pushNotificationToDiscord(notification.userId, notification);
        }
      : undefined,
  });

  const worker = createWorker({
    startScheduler: config.scheduler ? () => startRunScheduler() : undefined,
    startDiscord:
      discord && config.discord ? () => discord.startDiscordBot(config.discord!.token) : undefined,
    close: () => client.end({ timeout: 5 }),
    logger,
    shutdownTimeoutMs: config.shutdownTimeoutMs,
  });
  worker.start();
  logger.info("[run worker] started", {
    ...describeWorkerConfig(config),
    concurrency: runConfig.schedulerConcurrency,
    providers: runCapabilities(runConfig),
  });

  let signals = 0;
  const shutdown = (signal: string) => {
    signals += 1;
    if (signals > 1) {
      logger.warn(`[run worker] ${signal} again, exiting now`);
      process.exit(1);
    }
    logger.info(`[run worker] ${signal}: stopping`);
    void worker.stop().then(() => {
      logger.info("[run worker] stopped");
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[run worker] failed to start", error);
  process.exit(1);
});
