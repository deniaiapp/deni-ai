import dotenv from "dotenv";
import Module from "node:module";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });
process.env.DENI_SCHEDULER = "true";

// `server-only` is a Next.js compile-time guard. The standalone worker is already a
// trusted server process, so neutralize only that marker before loading server modules.
type NodeLoader = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
const moduleRuntime = Module as unknown as { _load: NodeLoader };
const originalLoad = moduleRuntime._load;
moduleRuntime._load = function load(request: string, parent: NodeModule | null, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const { startScheduler } = await import("../lib/scheduler");
  startScheduler();
  console.info("[deni worker] scheduler started");
  const { startDiscordBot } = await import("../lib/discord-bot");
  startDiscordBot();
}

void main();
