import "@tanstack/react-start/server-only";

import { releaseBrowserTakeover } from "./browser-workspaces";
import { setComputer } from "./computer";
import { runBackgroundJob } from "./job-runner";
import { cancelJob, getJob, retryJob } from "./jobs";
import type { AgentJob } from "./types";

/**
 * Stop a task from the web app or Discord. Null when it does not exist for this user or has
 * already finished.
 */
export async function cancelAndReleaseJob(userId: string, jobId: string, locale?: string) {
  const before = await getJob(userId, jobId);
  const job = await cancelJob(userId, jobId, locale);
  if (!job) return null;
  // A job parked for takeover or approval has no running handler to clean up after it, so
  // release its workspace here; otherwise the computer keeps showing "Your help is needed".
  if (before?.status === "waiting_takeover" || before?.status === "waiting_approval") {
    await releaseBrowserTakeover(userId, jobId).catch(() => undefined);
    await setComputer(userId, { status: "idle", workingLabel: "", workingBotId: null, jobId }).catch(() => undefined);
  }
  return job;
}

export type RetryResult =
  /** finished settles when the background run ends; it never rejects. */
  | { ok: true; job: AgentJob; finished: Promise<AgentJob | null> }
  | { ok: false; reason: "not_found" }
  /** Not failed or uncertain, out of attempts, or uncertain without reviewed. */
  | { ok: false; reason: "not_retryable"; job: AgentJob };

/**
 * Queue a failed task again and run it in the background, outside any request, so a closed
 * tab or an expired Discord interaction cannot stop it. An uncertain task may already have
 * had side effects, so it only runs again with reviewed.
 */
export async function retryAndRunJob(userId: string, jobId: string, options?: { reviewed?: boolean }): Promise<RetryResult> {
  const job = await retryJob(userId, jobId, { reviewed: options?.reviewed === true });
  if (!job) return { ok: false, reason: "not_found" };
  if (job.status !== "queued") return { ok: false, reason: "not_retryable", job };
  const finished = runBackgroundJob(userId, job.id).catch((error) => {
    console.error("[jobs] retry failed", error);
    return null;
  });
  return { ok: true, job, finished };
}
