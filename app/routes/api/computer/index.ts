import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import {
  billLiveBrowser,
  computerForJob,
  listWorkspace,
  releaseBrowser,
  screenshot,
  setComputer,
  withBrowserLive,
} from "@/lib/computer";
import { lastComputer } from "@/lib/events";
import { liveUsageSnapshot } from "@/lib/live-usage";
import { billLiveSandbox } from "@/lib/sandbox";
import { limitOrResponse } from "@/lib/rate-limit";
import { readStore } from "@/lib/store";

const WORKSPACE_LIST_TIMEOUT_MS = 8_000;
const SCREEN_CAPTURE_TIMEOUT_MS = 10_000;

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Workspace storage timed out")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function GET({ request: req }: { request: Request }) {
  const requestStartedAt = performance.now();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const authenticatedAt = performance.now();
  const limited = await limitOrResponse(userId, "computer", 180);
  if (limited) return limited;
  const limitedAt = performance.now();
  const searchParams = new URL(req.url).searchParams;
  const jobId = searchParams.get("jobId") || undefined;
  const shouldRefreshScreen = searchParams.get("refresh") === "1";
  const startedAt = Date.now();
  if (shouldRefreshScreen) {
    try {
      await withTimeout(screenshot(userId, jobId), SCREEN_CAPTURE_TIMEOUT_MS);
    } catch (error) {
      // Return the last known computer state if a capture is temporarily unavailable.
      if (process.env.NODE_ENV !== "production") {
        console.warn("[computer-api] screen refresh timed out or failed", {
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: Date.now() - startedAt,
        });
      }
    }
  } else {
    await billLiveBrowser(userId, jobId).catch(() => undefined);
  }
  await billLiveSandbox(userId).catch(() => undefined);
  const computerSyncedAt = performance.now();
  const store = await readStore(userId);
  const live = withBrowserLive(
    userId,
    computerForJob(lastComputer(userId) ?? store.computer, jobId),
  );
  let files: Awaited<ReturnType<typeof listWorkspace>> = [];
  const includeFiles = searchParams.get("files") === "1";
  if (includeFiles) {
    try {
      files = await withTimeout(listWorkspace(userId, ".", 6), WORKSPACE_LIST_TIMEOUT_MS);
    } catch (error) {
      files = [];
      if (process.env.NODE_ENV !== "production") {
        console.warn("[computer-api] workspace listing timed out or failed", {
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: Date.now() - startedAt,
        });
      }
    }
  }
  return Response.json(
    {
      computer: live,
      files,
      shells: store.shells ?? [],
      viewport: { width: 1280, height: 800 },
      usage: await liveUsageSnapshot(store, userId),
    },
    { headers: { "Cache-Control": "no-store", "Server-Timing": `auth;dur=${(authenticatedAt - requestStartedAt).toFixed(1)}, rate_limit;dur=${(limitedAt - authenticatedAt).toFixed(1)}, computer;dur=${(computerSyncedAt - limitedAt).toFixed(1)}, data;dur=${(performance.now() - computerSyncedAt).toFixed(1)}` } },
  );
}

async function POST({ request: req }: { request: Request }) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json().catch(() => ({}))) as { action?: string; jobId?: string };
  if (body.action === "release") {
    const jobId = body.jobId?.trim() || undefined;
    await releaseBrowser(userId, jobId);
    if (jobId) {
      await setComputer(userId, {
        status: "idle",
        workingBotId: null,
        workingLabel: "",
        lastError: null,
        jobId,
      });
    }
    const store = await readStore(userId);
    return Response.json({
      computer: withBrowserLive(
        userId,
        computerForJob(lastComputer(userId) ?? store.computer, jobId),
      ),
      usage: await liveUsageSnapshot(store, userId),
    });
  }
  await screenshot(userId, body.jobId?.trim() || undefined);
  const store = await readStore(userId);
  return Response.json({
    computer: withBrowserLive(
      userId,
      computerForJob(lastComputer(userId) ?? store.computer, body.jobId?.trim() || undefined),
    ),
    usage: await liveUsageSnapshot(store, userId),
  });
}

export const Route = createFileRoute("/api/computer/")({
  server: { handlers: { GET, POST } },
});
