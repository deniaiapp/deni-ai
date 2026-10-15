import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { hasApiKey } from "@/lib/config";
import { withBrowserLive } from "@/lib/computer";
import { listShells } from "@/lib/events";
import { liveUsageSnapshot } from "@/lib/live-usage";
import { parseRunMode } from "@/lib/model";
import { mutateStore, readStore } from "@/lib/store";

async function GET() {
  const startedAt = performance.now();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const authenticatedAt = performance.now();
  const store = await readStore(userId);
  return Response.json({
    ready: await hasApiKey(userId, store),
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
  }, { headers: { "Cache-Control": "no-store", "Server-Timing": `auth;dur=${(authenticatedAt - startedAt).toFixed(1)}, data;dur=${(performance.now() - authenticatedAt).toFixed(1)}` } });
}

async function PATCH({ request: req }: { request: Request }) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json()) as { runMode?: string };
  const runMode = parseRunMode(body.runMode);
  await mutateStore(userId, (store) => {
    store.config.runMode = runMode;
  });
  return Response.json({ ok: true, runMode });
}

export const Route = createFileRoute("/api/state")({
  server: { handlers: { GET, PATCH } },
});
