import { canCommitThreadResponse, groupJobsByThread, isActiveJob, jobVisualState, latestJob, mergeJobSnapshots, shouldMarkThreadUnread } from "../lib/job-view";
import { hasPendingWorkflowWait } from "../lib/chat-run-state";
import { mergeThreadMessages } from "../lib/messages";
import { cacheThreadMessages, clearThreadDraft, getThreadDraft, setThreadDraft } from "../lib/thread-state";
import type { AgentJob } from "../lib/types";

const base = (id: string, threadId: string, status: AgentJob["status"]): AgentJob => ({
  id,
  threadId,
  botId: "bot",
  kind: "chat",
  status,
  payload: {},
  result: null,
  checkpoint: null,
  attempt: 1,
  maxAttempts: 3,
  idempotencyKey: id,
  error: null,
  lockedAt: null,
  heartbeatAt: null,
  startedAt: null,
  finishedAt: null,
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
});

const a = base("a", "thread-a", "running");
const b = base("b", "thread-b", "completed");
const grouped = groupJobsByThread([a, b]);
if (jobVisualState(grouped["thread-a"] ?? []) !== "running") throw new Error("A did not stay running");
if (jobVisualState(grouped["thread-b"] ?? []) !== undefined) throw new Error("B inherited A's state");
if (jobVisualState([b, a]) !== "running") throw new Error("an older active job disappeared behind completed history");
if (!isActiveJob(a) || isActiveJob(b)) throw new Error("active state classification is incorrect");
if (jobVisualState([base("wait", "thread-a", "waiting_takeover")]) !== "waiting") throw new Error("takeover state is not waiting");
if (jobVisualState([base("uncertain", "thread-a", "uncertain")]) !== "attention") throw new Error("uncertain state is not attention");
const finalizing = base("finalizing", "thread-a", "finalizing");
if (!isActiveJob(finalizing) || jobVisualState([finalizing]) !== "running") throw new Error("saving state was not kept active");
if (shouldMarkThreadUnread(undefined, "completed", "thread-a", "thread-b")) throw new Error("initial completed job became unread");
if (!shouldMarkThreadUnread("running", "completed", "thread-a", "thread-b")) throw new Error("inactive completion did not become unread");
if (shouldMarkThreadUnread("running", "completed", "thread-a", "thread-a")) throw new Error("open thread became unread");
if (!shouldMarkThreadUnread("finalizing", "completed", "thread-a", "thread-b")) throw new Error("saving completion did not become unread");
const terminal = { ...a, status: "completed" as const, finishedAt: "2026-09-05T00:00:02.000Z", updatedAt: "2026-09-05T00:00:02.000Z" };
const staleRunning = { ...a, updatedAt: "2026-09-05T00:00:01.000Z" };
if (mergeJobSnapshots([terminal], [staleRunning])[0]?.status !== "completed") throw new Error("stale running poll rolled back a terminal job");
const retry = { ...staleRunning, attempt: 2, updatedAt: "2026-09-05T00:00:03.000Z" };
if (mergeJobSnapshots([terminal], [retry])[0]?.status !== "running") throw new Error("new retry was blocked by an old terminal snapshot");
if (latestJob([terminal, retry])?.id !== "a") throw new Error("latest job selection lost the retried job");
if (!hasPendingWorkflowWait({ content: [{ type: "tool-approval-request", isAutomatic: false }] })) throw new Error("approval wait was treated as completion");
if (!hasPendingWorkflowWait({ content: [{ type: "tool-result", toolName: "requestTakeover", output: { waiting: true } }] })) throw new Error("takeover wait was treated as completion");
if (!hasPendingWorkflowWait({ parts: [{ type: "tool-requestTakeover", state: "output-available", output: { waiting: true } }] })) throw new Error("static takeover wait was treated as completion");
if (hasPendingWorkflowWait({ content: [{ type: "tool-approval-request", isAutomatic: true }] })) throw new Error("automatic approval was treated as a human wait");
if (canCommitThreadResponse("thread-b", "thread-a")) throw new Error("delayed A response could overwrite B");
if (!canCommitThreadResponse("thread-a", "thread-a")) throw new Error("current thread response was rejected");
const persisted = [{ id: "message-a", role: "assistant" as const, parts: [{ type: "text" as const, text: "old" }] }];
const merged = mergeThreadMessages(persisted, [{ id: "message-a", role: "assistant" as const, parts: [{ type: "text" as const, text: "new" }] }]);
if (merged.length !== 1 || merged[0]?.id !== "message-a") throw new Error("message cache duplicated a response");
const drafts = new Map<string, string>();
setThreadDraft(drafts, "thread-a", "unsent draft");
if (getThreadDraft(drafts, "thread-a") !== "unsent draft") throw new Error("thread draft was not restored");
clearThreadDraft(drafts, "thread-a");
if (getThreadDraft(drafts, "thread-a") !== "") throw new Error("thread draft was not cleared after send");
const cachedA = cacheThreadMessages({}, "thread-a", persisted);
const cachedB = cacheThreadMessages(cachedA, "thread-b", [{ id: "message-b", role: "user" as const, parts: [{ type: "text" as const, text: "B" }] }]);
if (cachedB["thread-a"]?.[0]?.id !== "message-a" || cachedB["thread-b"]?.[0]?.id !== "message-b") throw new Error("thread message cache mixed conversations");
console.log("verified per-thread job grouping and loader/waiting/attention states");
