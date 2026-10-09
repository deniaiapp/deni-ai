export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DENI_SCHEDULER !== "true") return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
  const { startDiscordBot } = await import("./lib/discord-bot");
  startDiscordBot();
}
