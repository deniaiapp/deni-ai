import { definePlugin } from "nitro";

// Runs the routine scheduler and the Discord bot inside the web server when DENI_SCHEDULER=true.
// Deployments that run them in a separate process use `pnpm worker` instead.
export default definePlugin(() => {
  if (process.env.DENI_SCHEDULER !== "true") return;
  void import("@/lib/jobs/scheduler").then(({ startScheduler }) => startScheduler());
  void import("@/lib/discord/bot").then(({ startDiscordBot }) => startDiscordBot());
});
