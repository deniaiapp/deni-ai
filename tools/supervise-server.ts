/**
 * Keep the Bun server available after a runtime crash.
 *
 * Usage:
 *   bun run start:supervised
 *   bun run start:supervised -- --port 3000
 *
 * The supervisor exits on a clean server exit or after Ctrl+C. Non-zero exits
 * are treated as crashes and restarted with a bounded exponential backoff.
 */

const DEFAULT_RESTART_DELAY_MS = 2_000;
const MAX_RESTART_DELAY_MS = 30_000;
const STABLE_RUNTIME_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getServerArgs(): string[] {
  return Bun.argv.slice(2);
}

let currentProcess: Bun.Subprocess | null = null;
let stopping = false;

function stop(signal: "SIGINT" | "SIGTERM"): void {
  stopping = true;
  if (!currentProcess) return;

  try {
    currentProcess.kill(signal);
  } catch {
    currentProcess.kill();
  }
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const serverArgs = getServerArgs();

if (serverArgs.includes("--help") || serverArgs.includes("-h")) {
  console.log("Usage: bun run start:supervised -- [server.ts arguments]");
  process.exit(0);
}

let crashCount = 0;

while (!stopping) {
  const startedAt = Date.now();
  console.log(
    `[Supervisor] starting server: ${["server.ts", ...serverArgs].join(" ")}`,
  );

  currentProcess = Bun.spawn(
    [process.execPath, "run", "server.ts", ...serverArgs],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  const exitCode = await currentProcess.exited;
  currentProcess = null;

  if (stopping) {
    break;
  }

  if (exitCode === 0) {
    console.log("[Supervisor] server exited normally; not restarting.");
    process.exit(0);
  }

  const runtimeMs = Date.now() - startedAt;
  if (runtimeMs >= STABLE_RUNTIME_MS) {
    crashCount = 0;
  }
  crashCount += 1;

  const delayMs = Math.min(
    MAX_RESTART_DELAY_MS,
    DEFAULT_RESTART_DELAY_MS * 2 ** Math.min(crashCount - 1, 4),
  );
  console.error(
    `[Supervisor] server exited with code ${exitCode} after ${runtimeMs}ms; restarting in ${delayMs}ms (attempt ${crashCount}).`,
  );
  await sleep(delayMs);
}

console.log("[Supervisor] stopped.");

export {};
