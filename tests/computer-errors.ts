import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mockModules } from "./helpers/module-mocks";

mockModules((request) => (request === "@tanstack/react-start/server-only" ? {} : undefined));

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

let tempDir = "";

// The computer panel's error belongs to the work that hit it: it stays while nothing new happens,
// is replaced by a new error, and is cleared once the computer starts on new work.
async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-computer-errors-"));
  delete process.env.D1_PROXY_URL;
  process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  process.env.APP_ENCRYPTION_KEY ||= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  const { db } = await import("../src/db");
  const { user } = await import("../src/db/schema");
  const { setComputer } = await import("../src/lib/computer");
  const { readStore } = await import("../src/lib/data/store");

  const userId = "c1";
  await db.insert(user).values({ id: userId, name: userId, email: "c1@example.com", emailVerified: true });
  const lastError = async () => (await readStore(userId)).computer.lastError;

  // A browser error is recorded and stays through an idle update.
  await setComputer(userId, { status: "error", lastError: "The browser could not be started", jobId: "job_a" });
  await setComputer(userId, { status: "idle", workingLabel: "", jobId: "job_a" });
  assert((await lastError()) === "The browser could not be started", "an idle update should keep the error");

  // New work clears it, for the account and for the job's own workspace.
  await setComputer(userId, { status: "working", workingLabel: "Opening page", jobId: "job_b" });
  const cleared = await readStore(userId);
  assert(cleared.computer.lastError === null, `new work should clear the error, got ${cleared.computer.lastError}`);
  assert(cleared.computer.workspaces?.job_b?.lastError === null, "the new job's workspace must start without an error");

  // Work that reports its own error keeps it.
  await setComputer(userId, { status: "working", lastError: "Command failed", jobId: "job_b" });
  assert((await lastError()) === "Command failed", "an error reported with new work must be kept");

  // Clearing without a job, as a new chat turn does, empties the panel.
  await setComputer(userId, { lastError: null });
  assert((await lastError()) === null, "a new turn should clear the error");

  console.log("computer error verification passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    process.exit();
  });
