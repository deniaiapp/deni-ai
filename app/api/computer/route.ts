import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import {
  billLiveBrowser,
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

export const dynamic = "force-dynamic";

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

export async function GET(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "computer", 180);
  if (limited) return limited;
  const searchParams = new URL(req.url).searchParams;
  const shouldRefreshScreen = searchParams.get("refresh") === "1";
  const startedAt = Date.now();
  if (process.env.NODE_ENV !== "production") {
    console.info("[computer-api] state request received", {
      refresh: shouldRefreshScreen,
      files: searchParams.get("files") === "1",
    });
  }
  if (shouldRefreshScreen) {
    try {
      await withTimeout(screenshot(userId), SCREEN_CAPTURE_TIMEOUT_MS);
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
    await billLiveBrowser(userId).catch(() => undefined);
  }
  await billLiveSandbox(userId).catch(() => undefined);
  const store = await readStore(userId);
  const live = withBrowserLive(userId, lastComputer(userId) ?? store.computer);
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
  if (process.env.NODE_ENV !== "production") {
    console.info("[computer-api] state request completed", {
      elapsedMs: Date.now() - startedAt,
      files: files.length,
      screenshotAt: live.screenshotAt,
      status: live.status,
    });
  }
  return NextResponse.json(
    {
      computer: live,
      files,
      shells: store.shells ?? [],
      viewport: { width: 1280, height: 800 },
      usage: liveUsageSnapshot(store, userId),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "release") {
    await releaseBrowser(userId);
    await setComputer(userId, {
      status: "idle",
      workingBotId: null,
      workingLabel: "",
      lastError: null,
    });
    const store = await readStore(userId);
    return NextResponse.json({
      computer: withBrowserLive(userId, lastComputer(userId) ?? store.computer),
      usage: liveUsageSnapshot(store, userId),
    });
  }
  await screenshot(userId);
  const store = await readStore(userId);
  return NextResponse.json({
    computer: withBrowserLive(userId, lastComputer(userId) ?? store.computer),
    usage: liveUsageSnapshot(store, userId),
  });
}
