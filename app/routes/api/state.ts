import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { hasApiKey } from "@/lib/config";
import { withBrowserLive } from "@/lib/computer";
import { listShells } from "@/lib/events";
import { listJobOverview } from "@/lib/jobs";
import { liveUsageSnapshot } from "@/lib/live-usage";
import { slimMessagesForClient } from "@/lib/messages";
import { parseRunMode } from "@/lib/model";
import { listNotifications } from "@/lib/notifications";
import { loadMessages, mutateStore, readStore } from "@/lib/store";
import { applyTeammateCopy, type TeammateCopy } from "@/lib/teammate-copy";
import { locales, type Locale } from "@/i18n/config";
import { getExtracted, getLocale } from "@/i18n/server";

/** The starting names of the default teammates in one language. */
async function teammateCopy(locale: Locale): Promise<TeammateCopy> {
  const t = await getExtracted({ locale });
  return {
    bots: {
      chief: { name: t("Chief"), job: t("Team coordination") },
      research: { name: t("Research"), job: t("Research and reports") },
      ops: { name: t("Operations"), job: t("Computer execution") },
    },
    preview: t("Send me a task"),
  };
}

async function GET({ request }: { request: Request }) {
  const startedAt = performance.now();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const authenticatedAt = performance.now();
  const store = await readStore(userId);
  const [locale, copies] = await Promise.all([getLocale(), Promise.all(locales.map(teammateCopy))]);
  const current = copies[locales.indexOf(locale)] ?? copies[0];
  // Untouched default teammates follow the language the workspace is opened in.
  if (current && applyTeammateCopy(store, copies, current)) {
    await mutateStore(userId, (latest) => void applyTeammateCopy(latest, copies, current));
  }
  // Opening the workspace asks for everything its first screen needs in one round, read in
  // parallel: each separate request would wait on its own database round trips.
  const boot = new URL(request.url).searchParams.get("boot") === "1";
  const firstThreadId = boot ? store.threads[0]?.id : undefined;
  const [ready, usage, jobs, notifications, firstMessages] = await Promise.all([
    hasApiKey(userId, store),
    liveUsageSnapshot(store, userId, { cachedOnly: boot }),
    boot ? listJobOverview(userId, 200, true) : undefined,
    boot ? listNotifications(userId, { unreadOnly: true }).catch(() => undefined) : undefined,
    firstThreadId ? loadMessages(userId, firstThreadId, { clone: false }) : undefined,
  ]);
  return Response.json({
    ready,
    timezone: store.config.timezone,
    model: store.config.model,
    runMode: parseRunMode(store.config.runMode),
    bots: store.bots,
    threads: store.threads,
    skills: store.skills,
    routines: store.routines,
    computer: withBrowserLive(userId, store.computer),
    shells: store.shells ?? listShells(userId),
    usage,
    ...(boot
      ? {
          jobs,
          notifications,
          thread: firstThreadId && firstMessages ? { id: firstThreadId, messages: slimMessagesForClient(firstMessages) } : undefined,
        }
      : {}),
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
