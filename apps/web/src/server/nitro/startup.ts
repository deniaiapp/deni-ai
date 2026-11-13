import { definePlugin } from "nitro";

/**
 * Nitro runtime plugin (registered in vite.config.ts): the app's server entry
 * (`src/server.ts`, which awaits `register()` from `src/instrumentation.ts`) is loaded
 * on the first request. In production one internal request right after startup loads
 * it, so the in-process schedulers (model health, background jobs, Run) start at boot,
 * also after a crash restart or a host reboot that no health check follows.
 */
export default definePlugin((nitroApp) => {
  if (process.env.NODE_ENV !== "production") return;
  setTimeout(() => {
    Promise.resolve(nitroApp.fetch(new Request("http://localhost/api/status/models")))
      .then((response) => response.body?.cancel())
      .catch((error: unknown) => console.error("[startup] warm-up request failed", error));
  }, 0);
});
