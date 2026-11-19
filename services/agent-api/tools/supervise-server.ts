/**
 * Keep the Node server available after a runtime crash.
 *
 * Usage:
 *   pnpm run start:supervised
 *   pnpm run start:supervised -- --port 3000
 *
 * The supervisor exits on a clean server exit or after Ctrl+C. Non-zero exits
 * are treated as crashes and restarted with a bounded exponential backoff.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";

const DEFAULT_RESTART_DELAY_MS = 2_000;
const MAX_RESTART_DELAY_MS = 30_000;
const STABLE_RUNTIME_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getServerArgs(): string[] {
  return process.argv.slice(2);
}

let currentProcess: ChildProcess | null = null;
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
  console.log("Usage: pnpm run start:supervised -- [server.ts arguments]");
  process.exit(0);
}

let crashCount = 0;

while (!stopping) {
  const startedAt = Date.now();
  console.log(
    `[Supervisor] starting server: ${["server.ts", ...serverArgs].join(" ")}`,
  );

  // Run the TypeScript entrypoint through tsx's loader on the same Node binary.
  // Env vars (including any loaded via --env-file) are inherited.
  currentProcess = spawn(
    process.execPath,
    ["--import", "tsx", "server.ts", ...serverArgs],
    { stdio: "inherit" },
  );

  const [code, signal] = (await once(currentProcess, "exit")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  // A signal-terminated child has no exit code; treat it as a crash.
  const exitCode = code ?? (signal ? `signal ${signal}` : 1);
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
