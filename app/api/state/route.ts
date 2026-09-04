import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { hasApiKey } from "@/lib/config";
import { withBrowserLive } from "@/lib/computer";
import { listShells } from "@/lib/events";
import { liveUsageSnapshot } from "@/lib/live-usage";
import { parseRunMode } from "@/lib/model";
import { mutateStore, readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const store = await readStore(userId);
  return NextResponse.json({
    ready: await hasApiKey(userId),
    timezone: store.config.timezone,
    model: store.config.model,
    runMode: parseRunMode(store.config.runMode),
    bots: store.bots,
    threads: store.threads,
    skills: store.skills,
    routines: store.routines,
    computer: withBrowserLive(userId, store.computer),
    shells: store.shells ?? listShells(userId),
    usage: liveUsageSnapshot(store, userId),
  });
}

export async function PATCH(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json()) as { runMode?: string };
  const runMode = parseRunMode(body.runMode);
  await mutateStore(userId, (store) => {
    store.config.runMode = runMode;
  });
  return NextResponse.json({ ok: true, runMode });
}
