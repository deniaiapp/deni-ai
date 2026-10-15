import dotenv from "dotenv";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });
process.env.DENI_SCHEDULER = "true";

async function main() {
  const { startScheduler } = await import("../lib/scheduler");
  startScheduler();
  console.info("[deni worker] scheduler started");
  const { startDiscordBot } = await import("../lib/discord-bot");
  startDiscordBot();
}

void main();
