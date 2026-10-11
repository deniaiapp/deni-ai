import dotenv from "dotenv";
import { registerHooks } from "node:module";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });
process.env.DENI_SCHEDULER = "true";

// `server-only` is a Next.js compile-time guard. The standalone worker is already a
// trusted server process, so neutralize only that marker before loading server modules.
// The package is ESM, so this hooks resolution for both import and require.
const SERVER_ONLY_STUB = "deni-stub:server-only";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: SERVER_ONLY_STUB, format: "module", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === SERVER_ONLY_STUB) return { format: "module", source: "", shortCircuit: true };
    return nextLoad(url, context);
  },
});

async function main() {
  const { startScheduler } = await import("../lib/scheduler");
  startScheduler();
  console.info("[deni worker] scheduler started");
  const { startDiscordBot } = await import("../lib/discord-bot");
  startDiscordBot();
}

void main();
