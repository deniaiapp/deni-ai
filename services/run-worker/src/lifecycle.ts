export type Stoppable = { stop(): Promise<void> };

export type WorkerParts = {
  /** Starts claiming jobs; resolves the returned stop once running jobs have finished. */
  startScheduler?: () => () => Promise<void>;
  /** Connects the Discord bot. */
  startDiscord?: () => Stoppable;
  /** Ends the database pool. */
  close: () => Promise<void>;
  logger: Pick<Console, "info" | "warn" | "error">;
  shutdownTimeoutMs: number;
};

function withTimeout(promise: Promise<void>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  return Promise.race([promise.then(() => "done" as const), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * The worker's start/stop order. Shutdown stops claiming first and waits (bounded) for
 * running jobs, then disconnects Discord, then ends the pool — so nothing still running
 * loses its database. A job cut off by the timeout keeps its lease; the next scheduler
 * marks it `uncertain` after the lease expires.
 */
export function createWorker(parts: WorkerParts) {
  let stopScheduler: (() => Promise<void>) | null = null;
  let discord: Stoppable | null = null;
  let stopping: Promise<void> | null = null;

  return {
    start() {
      if (parts.startScheduler) stopScheduler = parts.startScheduler();
      if (parts.startDiscord) discord = parts.startDiscord();
    },
    stop() {
      stopping ??= (async () => {
        if (stopScheduler) {
          const result = await withTimeout(
            stopScheduler().catch((error) =>
              parts.logger.error("[run worker] scheduler stop", error),
            ),
            parts.shutdownTimeoutMs,
          );
          if (result === "timeout")
            parts.logger.warn(
              "[run worker] running jobs did not finish before the shutdown timeout",
            );
        }
        if (discord)
          await discord
            .stop()
            .catch((error) => parts.logger.error("[run worker] discord stop", error));
        await parts
          .close()
          .catch((error) => parts.logger.error("[run worker] database close", error));
      })();
      return stopping;
    },
  };
}
