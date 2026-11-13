/**
 * Work to finish before the server process exits. Nitro's graceful shutdown (SIGTERM
 * or SIGINT) awaits its `close` hooks, and `src/server/nitro/shutdown.ts` runs these
 * handlers from one, in registration order.
 *
 * The registry lives on `globalThis`: the Nitro plugin and the app's server bundle are
 * separate module graphs, so a module-level array would not be shared between them.
 */

export type ShutdownHandler = { name: string; run: () => Promise<void> | void };

const globalForShutdown = globalThis as typeof globalThis & {
  __deniShutdownHandlers?: ShutdownHandler[];
};

export function onShutdown(name: string, run: ShutdownHandler["run"]) {
  (globalForShutdown.__deniShutdownHandlers ??= []).push({ name, run });
}

/** Runs and forgets every registered handler; a failing one does not stop the rest. */
export async function runShutdownHandlers(logger: Pick<Console, "error"> = console) {
  const handlers = (globalForShutdown.__deniShutdownHandlers ??= []).splice(0);
  for (const handler of handlers) {
    try {
      await handler.run();
    } catch (error) {
      logger.error(`[shutdown] ${handler.name}`, error);
    }
  }
}
