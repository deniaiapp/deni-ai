import { definePlugin } from "nitro";
import { runShutdownHandlers } from "../../lib/shutdown.server";

/**
 * Nitro runtime plugin (registered in vite.config.ts): on graceful shutdown, run the
 * handlers of `src/lib/shutdown.server.ts`, e.g. the in-process Run scheduler waiting
 * for its jobs. Nitro awaits `close` hooks before the process exits.
 */
export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("close", () => runShutdownHandlers());
});
