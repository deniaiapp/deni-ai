import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { hasApiKey } from "@/lib/config";
import { withBrowserLive } from "@/lib/computer";
import { listShells } from "@/lib/events";
import { readStore } from "@/lib/store";
import { liveUsageSnapshot } from "@/lib/live-usage";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const store = await readStore(userId);
  return NextResponse.json({
    ready: await hasApiKey(userId),
    timezone: store.config.timezone,
    model: store.config.model,
    bots: store.bots,
    threads: store.threads,
    skills: store.skills,
    routines: store.routines,
    computer: withBrowserLive(userId, store.computer),
    shells: store.shells ?? listShells(userId),
    usage: liveUsageSnapshot(store, userId),
  });
}
