import { getExtracted } from "@deniai/i18n/extracted";
import { z } from "zod";
import { env } from "@/env";
import { loadMessages as loadIntlMessages } from "@/i18n/messages";
import {
  createDiscordLinkCode,
  getDiscordLink,
  unlinkDiscord,
} from "@/lib/run/discord-link.server";
import { runStatus } from "@/lib/run/runtime.server";
import {
  authenticateRun,
  errorMessage,
  limitRun,
  readJson,
  runError,
  runJson,
  type RunRequestContext,
} from "./context";
import { handleGroupChat } from "./group-chat";

/**
 * The Run API: `/api/run/<resource>/...`, dispatched here from the catch-all route
 * (`src/routes/api/run/$.ts`). Every handler runs for a signed-in, non-guest user
 * against the configured `@deniai/run` runtime. Modules of `@deniai/run` are imported
 * per endpoint so a request only loads what it uses.
 */

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type Handler = (context: RunRequestContext, params: string[]) => Promise<Response>;

const avatarIcon = z.string().max(400_000).nullable();
const teammateSchema = z.object({
  name: z.string().trim().max(80).optional(),
  job: z.string().trim().max(120).optional(),
  instructions: z.string().trim().max(20_000).optional(),
  icon: avatarIcon.optional(),
  tools: z.array(z.string().min(1).max(40)).max(20).nullable().optional(),
  computerAccess: z.boolean().optional(),
});

function usageLimit(error: { message: string; metric?: string }) {
  return runError(402, "usage_limit", { metric: error.metric ?? "budget", message: error.message });
}

async function teammateCopies(locale: "en" | "ja") {
  const copyFor = async (target: "en" | "ja") => {
    const t = getExtracted({ locale: target, messages: await loadIntlMessages(target) });
    return {
      bots: {
        chief: { name: t("Chief"), job: t("Team coordination") },
        research: { name: t("Research"), job: t("Research and reports") },
        ops: { name: t("Operations"), job: t("Computer execution") },
      },
      preview: t("Send me a task"),
    };
  };
  const copies = await Promise.all([copyFor("en"), copyFor("ja")]);
  return { copies, current: copies[locale === "ja" ? 1 : 0]! };
}

const handlers: Record<string, Partial<Record<Method, Handler>>> = {
  status: {
    GET: async () => runJson(runStatus()),
  },

  state: {
    GET: async ({ userId, locale }) => {
      const [{ readStore, mutateStore }, { hasApiKey }, { usageSnapshot, teammateLimit }] =
        await Promise.all([
          import("@deniai/run/data/store"),
          import("@deniai/run/data/config"),
          import("@deniai/run/billing/usage"),
        ]);
      const { applyTeammateCopy } = await import("@deniai/run/teammates/copy");
      const { listNotifications } = await import("@deniai/run/jobs/notifications");
      const { listJobOverview } = await import("@deniai/run/jobs/index");
      let store = await readStore(userId);
      const { copies, current } = await teammateCopies(locale);
      if (applyTeammateCopy(store, copies, current)) {
        store = await mutateStore(userId, (latest) => {
          applyTeammateCopy(latest, copies, current);
          return latest;
        });
      }
      const [ready, usage, limit, unread, jobs] = await Promise.all([
        hasApiKey(userId, store),
        usageSnapshot(userId, store),
        teammateLimit(userId),
        listNotifications(userId, { unreadOnly: true }).catch(() => []),
        listJobOverview(userId, 50, true).catch(() => []),
      ]);
      const status = runStatus();
      return runJson({
        ready,
        capabilities: status.capabilities,
        timezone: store.config.timezone,
        runMode: store.config.runMode,
        bots: store.bots,
        threads: store.threads,
        skills: store.skills,
        routines: store.routines,
        computer: store.computer,
        usage,
        teammateLimit: limit,
        unreadNotifications: unread.length,
        jobs,
      });
    },
    PATCH: async ({ request, userId }) => {
      const body = await readJson<{ runMode?: string; timezone?: string }>(request);
      const { parseRunMode } = await import("@deniai/run/agent/model");
      const { mutateStore } = await import("@deniai/run/data/store");
      if (body?.timezone !== undefined) {
        const { setDefaultTimezone } = await import("@deniai/run/jobs/routines");
        const timezone = await setDefaultTimezone(userId, String(body.timezone));
        if (!timezone) return runError(400, "invalid_timezone");
      }
      if (body?.runMode !== undefined) {
        const runMode = parseRunMode(body.runMode);
        await mutateStore(userId, (store) => {
          store.config.runMode = runMode;
        });
      }
      return runJson({ ok: true });
    },
  },

  teammates: {
    POST: async ({ request, userId, locale }) => {
      const limited = await limitRun(userId, "teammates", 20);
      if (limited) return limited;
      const parsed = teammateSchema.safeParse(await readJson(request));
      if (!parsed.success) return runError(400, "invalid_teammate");
      const { createTeammate } = await import("@deniai/run/teammates/index");
      const { current } = await teammateCopies(locale);
      const result = await createTeammate(userId, parsed.data, { preview: current.preview });
      if (!result.ok) {
        if (result.reason === "invalid_icon") return runError(400, "invalid_icon");
        if (result.reason === "name_required") return runError(400, "name_required");
        return usageLimit(result.error);
      }
      return runJson({ bot: result.bot, thread: result.thread }, { status: 201 });
    },
  },

  "teammates/:id": {
    PATCH: async ({ request, userId }, [id]) => {
      const parsed = teammateSchema.safeParse(await readJson(request));
      if (!parsed.success) return runError(400, "invalid_teammate");
      const { updateTeammate } = await import("@deniai/run/teammates/index");
      const result = await updateTeammate(userId, id!, parsed.data);
      if (!result.ok) return runError(result.reason === "invalid_icon" ? 400 : 404, result.reason);
      return runJson({ bot: result.bot });
    },
    DELETE: async ({ userId }, [id]) => {
      const { deleteTeammate } = await import("@deniai/run/teammates/index");
      const result = await deleteTeammate(userId, id!);
      if (!result.ok) return runError(400, "default_teammate");
      return runJson({ ok: true });
    },
  },

  "teammates/:id/memory": {
    DELETE: async ({ request, userId }, [id]) => {
      const body = await readJson<{ ids?: unknown }>(request);
      const ids = Array.isArray(body?.ids)
        ? body.ids.filter((item) => typeof item === "string")
        : [];
      const { forgetTeammateMemory } = await import("@deniai/run/teammates/index");
      const result = await forgetTeammateMemory(userId, id!, ids as string[]);
      if (!result.ok) return runError(404, "not_found");
      return runJson({ bot: result.bot, removed: result.removed });
    },
  },

  threads: {
    POST: async ({ request, userId }) => {
      const parsed = z
        .object({
          title: z.string().trim().max(120).optional(),
          botIds: z.array(z.string().min(1)).min(2).max(50),
          icon: avatarIcon.optional(),
        })
        .safeParse(await readJson(request));
      if (!parsed.success) return runError(400, "invalid_group");
      const { createGroup } = await import("@deniai/run/chat/groups");
      const result = await createGroup(userId, parsed.data);
      if (!result.ok) return runError(400, "invalid_group");
      return runJson({ thread: result.thread }, { status: 201 });
    },
  },

  "threads/:id": {
    GET: async ({ userId }, [id]) => {
      const { readStore, loadMessages } = await import("@deniai/run/data/store");
      const { slimMessagesForClient } = await import("@deniai/run/chat/messages");
      const store = await readStore(userId);
      const thread = store.threads.find((item) => item.id === id);
      if (!thread) return runError(404, "thread_not_found");
      const messages = slimMessagesForClient(await loadMessages(userId, id!));
      return runJson({ thread, messages });
    },
    PATCH: async ({ request, userId }, [id]) => {
      const parsed = z
        .object({
          pinned: z.boolean().optional(),
          unread: z.boolean().optional(),
          hidden: z.boolean().optional(),
          title: z.string().trim().min(1).max(120).optional(),
          icon: avatarIcon.optional(),
          botIds: z.array(z.string().min(1)).min(2).max(50).optional(),
        })
        .safeParse(await readJson(request));
      if (!parsed.success) return runError(400, "invalid_thread");
      const body = parsed.data;
      const { mutateStore } = await import("@deniai/run/data/store");
      const { applyGroupEdits } = await import("@deniai/run/chat/groups");
      const result = await mutateStore(userId, (store) => {
        const item = store.threads.find((entry) => entry.id === id);
        if (!item) return { error: "thread_not_found" as const };
        if (body.title !== undefined || body.icon !== undefined || body.botIds !== undefined) {
          const edited = applyGroupEdits(store, item, body);
          if (!edited.ok) return { error: edited.reason };
        }
        if (typeof body.pinned === "boolean") item.pinned = body.pinned;
        if (typeof body.unread === "boolean") item.unread = body.unread;
        if (typeof body.hidden === "boolean") item.hidden = body.hidden;
        return { thread: item };
      });
      if ("error" in result)
        return runError(
          result.error === "thread_not_found" ? 404 : 400,
          result.error ?? "invalid_thread",
        );
      return runJson(result);
    },
    DELETE: async ({ userId }, [id]) => {
      const { deleteGroupThread } = await import("@deniai/run/data/store");
      return (await deleteGroupThread(userId, id!))
        ? runJson({ deleted: id })
        : runError(404, "thread_not_found");
    },
  },

  "threads/:id/reset": {
    POST: async ({ request, userId }, [id]) => {
      const limited = await limitRun(userId, "thread-reset", 20);
      if (limited) return limited;
      const body = await readJson<{ clear?: unknown }>(request);
      const { clearThread, resetThreadContext } = await import("@deniai/run/agent/thread-context");
      const result =
        body?.clear === true
          ? await clearThread(userId, id!)
          : await resetThreadContext(userId, id!);
      if (result === "missing") return runError(404, "thread_not_found");
      if (result === "busy") return runError(409, "thread_busy");
      const { loadMessages } = await import("@deniai/run/data/store");
      const { slimMessagesForClient } = await import("@deniai/run/chat/messages");
      return runJson({ result, messages: slimMessagesForClient(await loadMessages(userId, id!)) });
    },
  },

  "threads/:id/reactions": {
    PUT: async ({ request, userId }, [id]) => {
      const { isMessageReaction, updateReactions } =
        await import("@deniai/run/chat/message-actions");
      const parsed = z
        .object({
          messageId: z.string().min(1).max(512),
          emoji: z.string().max(64).refine(isMessageReaction),
          selected: z.boolean(),
        })
        .safeParse(await readJson(request));
      if (!parsed.success) return runError(400, "invalid_reaction");
      const { messageId, emoji, selected } = parsed.data;
      const { mutateStore } = await import("@deniai/run/data/store");
      const reactions = await mutateStore(userId, (store) => {
        const thread = store.threads.find((item) => item.id === id);
        if (!thread) return null;
        const map = { ...thread.reactions };
        const updated = updateReactions(map[messageId] ?? [], emoji, selected);
        if (updated.length) map[messageId] = updated;
        else delete map[messageId];
        thread.reactions = map;
        return map;
      });
      return reactions ? runJson({ reactions }) : runError(404, "thread_not_found");
    },
  },

  chat: {
    POST: async ({ request, userId, locale }) => {
      const limited = await limitRun(userId, "chat", 40);
      if (limited) return limited;
      const { handleChat } = await import("@deniai/run/chat/route");
      return handleChat(request, { userId, locale });
    },
  },

  "group-chat": {
    POST: async (context) => {
      const limited = await limitRun(context.userId, "chat", 40);
      if (limited) return limited;
      return handleGroupChat(context);
    },
  },

  jobs: {
    GET: async ({ url, userId }) => {
      const { listJobOverview, listJobs } = await import("@deniai/run/jobs/index");
      const threadId = url.searchParams.get("threadId") || undefined;
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const jobs = threadId
        ? await listJobs(userId, {
            threadId,
            limit: Number.isFinite(limit) ? limit : 50,
            summary: true,
          })
        : await listJobOverview(userId, Number.isFinite(limit) ? limit : 200, true);
      return runJson({ jobs });
    },
  },

  "jobs/:id": {
    GET: async ({ url, userId }, [id]) => {
      const { getJob, listJobEvents } = await import("@deniai/run/jobs/index");
      const job = await getJob(userId, id!);
      if (!job) return runError(404, "job_not_found");
      const after = Number(url.searchParams.get("after") ?? 0);
      const { payload: _payload, ...summary } = job;
      return runJson({
        job: summary,
        events: await listJobEvents(userId, id!, Number.isFinite(after) ? after : 0),
      });
    },
    POST: async ({ request, userId, locale }, [id]) => {
      const body = await readJson<{ action?: string; reviewed?: boolean }>(request);
      const { getJob } = await import("@deniai/run/jobs/index");
      const { cancelAndReleaseJob, retryAndRunJob } = await import("@deniai/run/jobs/actions");
      if (body?.action === "cancel") {
        const job = await cancelAndReleaseJob(userId, id!, locale);
        return job ? runJson({ job }) : runError(409, "job_not_cancellable");
      }
      if (body?.action === "retry") {
        const retried = await retryAndRunJob(userId, id!, { reviewed: body.reviewed === true });
        if (!retried.ok && retried.reason === "not_found") return runError(404, "job_not_found");
        if (!retried.ok) return runError(409, "job_not_retryable", { job: retried.job });
        return runJson({ job: retried.job }, { status: 202 });
      }
      if (body?.action === "resume") {
        const current = await getJob(userId, id!);
        if (!current) return runError(404, "job_not_found");
        if (current.status !== "waiting_approval" && current.status !== "waiting_takeover")
          return runError(409, "job_not_waiting", { job: current });
        // Only a chat request carrying new input or an approval response resumes it.
        return runJson({ job: current, resumeVia: "chat" });
      }
      return runError(400, "unsupported_action");
    },
  },

  notifications: {
    GET: async ({ url, userId }) => {
      const { listNotifications } = await import("@deniai/run/jobs/notifications");
      const unreadOnly = url.searchParams.get("unread") === "1";
      return runJson({ notifications: await listNotifications(userId, { unreadOnly }) });
    },
    PATCH: async ({ request, userId }) => {
      const body = await readJson<{ id?: string; read?: boolean; all?: boolean }>(request);
      const { markAllNotificationsRead, markNotificationRead } =
        await import("@deniai/run/jobs/notifications");
      if (body?.all) {
        await markAllNotificationsRead(userId);
        return runJson({ ok: true });
      }
      if (!body?.id) return runError(400, "id_required");
      const notification = await markNotificationRead(userId, body.id, body.read !== false);
      return notification ? runJson({ notification }) : runError(404, "not_found");
    },
  },

  artifacts: {
    GET: async ({ url, userId }) => {
      const { listArtifacts } = await import("@deniai/run/agent/artifacts");
      const threadId = url.searchParams.get("threadId") || undefined;
      return runJson({ artifacts: await listArtifacts(userId, threadId) });
    },
  },

  "artifacts/:id": {
    GET: async ({ url, userId }, [id]) => {
      const { getArtifact } = await import("@deniai/run/agent/artifacts");
      const artifact = await getArtifact(userId, id!);
      if (!artifact) return runError(404, "artifact_not_found");
      const { readWorkspaceBytes, readWorkspaceFile } =
        await import("@deniai/run/computer/workspace");
      try {
        if (url.searchParams.get("mode") === "download") {
          const file = await readWorkspaceBytes(userId, artifact.path);
          return new Response(new Uint8Array(file.data), {
            headers: {
              "Content-Type": artifact.mimeType,
              "Content-Disposition": `attachment; filename="${artifact.title.replace(/[^A-Za-z0-9._-]+/g, "_")}"`,
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }
        const file = await readWorkspaceFile(userId, artifact.path);
        return runJson({ artifact, content: file.content });
      } catch (error) {
        return runError(404, "artifact_unavailable", { message: errorMessage(error) });
      }
    },
  },

  skills: {
    GET: async ({ userId }) => {
      const { readStore } = await import("@deniai/run/data/store");
      return runJson({ skills: (await readStore(userId)).skills });
    },
    POST: async (context) => saveSkill(context, false),
    PATCH: async (context) => saveSkill(context, true),
    DELETE: async ({ request, userId }) => {
      const body = await readJson<{ id?: string }>(request);
      if (!body?.id) return runError(400, "id_required");
      const { deleteSkill } = await import("@deniai/run/agent/skills");
      return (await deleteSkill(userId, body.id))
        ? runJson({ deleted: body.id })
        : runError(404, "skill_not_found");
    },
  },

  routines: {
    GET: async ({ userId }) => {
      const { readStore } = await import("@deniai/run/data/store");
      const store = await readStore(userId);
      return runJson({ routines: store.routines, timezone: store.config.timezone });
    },
    POST: async ({ request, userId, locale }) => {
      const body = await readJson(request);
      const { createRoutine } = await import("@deniai/run/jobs/routines");
      try {
        const result = await createRoutine(userId, body as never, locale);
        if (result.ok) return runJson({ routine: result.routine }, { status: 201 });
        return result.reason === "invalid"
          ? runError(400, "invalid_routine", { field: result.field })
          : runError(404, "routine_target_not_found");
      } catch (error) {
        return runError(400, "invalid_routine", { field: "cron", message: errorMessage(error) });
      }
    },
    PATCH: async ({ request, userId, locale }) => {
      const body = await readJson(request);
      const { updateRoutine } = await import("@deniai/run/jobs/routines");
      try {
        const result = await updateRoutine(userId, body as never, locale);
        if (result.ok) return runJson({ routine: result.routine });
        return result.reason === "invalid"
          ? runError(400, "invalid_routine", { field: result.field })
          : runError(404, "routine_not_found");
      } catch (error) {
        return runError(400, "invalid_routine", { field: "cron", message: errorMessage(error) });
      }
    },
    DELETE: async ({ request, userId }) => {
      const body = await readJson<{ id?: string }>(request);
      if (!body?.id) return runError(400, "id_required");
      const { deleteRoutine } = await import("@deniai/run/jobs/routines");
      return (await deleteRoutine(userId, body.id))
        ? runJson({ deleted: body.id })
        : runError(404, "routine_not_found");
    },
  },

  computer: {
    GET: async ({ url, userId }) => {
      const limited = await limitRun(userId, "computer", 180);
      if (limited) return limited;
      const status = runStatus();
      const jobId = url.searchParams.get("jobId") || undefined;
      const { readStore } = await import("@deniai/run/data/store");
      const { computerForJob, lastComputer, withBrowserLive } =
        await import("@deniai/run/computer/index");
      const store = await readStore(userId);
      const computer = withBrowserLive(
        userId,
        computerForJob(lastComputer(userId) ?? store.computer, jobId),
      );
      return runJson({
        capabilities: status.capabilities,
        computer,
        liveViewUrl: status.capabilities?.browser ? computer.steelDebugUrl : null,
        shells: store.shells ?? [],
      });
    },
    POST: async ({ request, userId }) => {
      const status = runStatus();
      const body = await readJson<{ action?: string; jobId?: string }>(request);
      const jobId = body?.jobId?.trim() || undefined;
      const computerModule = await import("@deniai/run/computer/index");
      if (body?.action === "release") {
        await computerModule.releaseBrowser(userId, jobId);
        if (jobId)
          await computerModule.setComputer(userId, {
            status: "idle",
            workingBotId: null,
            workingLabel: "",
            lastError: null,
            jobId,
          });
        return runJson({ ok: true });
      }
      if (body?.action === "refresh") {
        if (!status.capabilities?.browser) return runError(409, "browser_unconfigured");
        await computerModule.screenshot(userId, jobId).catch(() => null);
        return runJson({ ok: true });
      }
      return runError(400, "unsupported_action");
    },
  },

  "computer/screenshot": {
    GET: async ({ url, userId }) => {
      const { getScreenshot } = await import("@deniai/run/computer/index");
      const image = await getScreenshot(userId, url.searchParams.get("jobId") || undefined);
      if (!image) return runError(404, "no_screenshot");
      return new Response(new Uint8Array(image), {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      });
    },
  },

  mcp: {
    GET: async ({ userId }) => {
      const { listMcpConnections, mcpAlwaysAllowed } = await import("@deniai/run/mcp/index");
      const { mcpCatalog } = await import("@deniai/run/mcp/catalog");
      const connections = await listMcpConnections(userId);
      const alwaysAllow = Object.fromEntries(
        await Promise.all(
          connections.map(async (connection) => [
            connection.id,
            await mcpAlwaysAllowed(userId, connection.id),
          ]),
        ),
      );
      return runJson({ connections, alwaysAllow, catalog: mcpCatalog });
    },
    POST: async ({ request, url, userId }) => {
      const body = await readJson<{
        action?: string;
        id?: string;
        catalogId?: string;
        tool?: string;
        name?: string;
        url?: string;
        transport?: "streamable-http" | "sse";
        secret?: string;
        headers?: Record<string, string>;
        enabled?: boolean;
      }>(request);
      if (!body) return runError(400, "invalid_body");
      const mcp = await import("@deniai/run/mcp/index");
      try {
        switch (body.action) {
          case "connect": {
            if (!body.id && !body.catalogId) return runError(400, "id_required");
            const limited = await limitRun(userId, "mcp-connect", 20);
            if (limited) return limited;
            return runJson(
              await mcp.startMcpSignIn(
                userId,
                { id: body.id, catalogId: body.catalogId },
                env.NEXT_PUBLIC_BETTER_AUTH_URL || url.origin,
              ),
            );
          }
          case "tools":
            if (!body.id) return runError(400, "id_required");
            return runJson(await mcp.listMcpTools(userId, body.id));
          case "test":
            if (!body.id) return runError(400, "id_required");
            return runJson(await mcp.testMcpConnection(userId, body.id));
          case "enable":
            if (!body.id || typeof body.enabled !== "boolean") return runError(400, "id_required");
            return runJson({
              connection: await mcp.setMcpConnectionEnabled(userId, body.id, body.enabled),
            });
          case "delete":
            if (!body.id) return runError(400, "id_required");
            return (await mcp.deleteMcpConnection(userId, body.id))
              ? runJson({ ok: true })
              : runError(404, "connection_not_found");
          case "always-allow":
            if (!body.id || !body.tool || typeof body.enabled !== "boolean")
              return runError(400, "invalid_permission");
            await mcp.setMcpAlwaysAllow(userId, body.id, body.tool, body.enabled);
            return runJson({ alwaysAllow: await mcp.mcpAlwaysAllowed(userId, body.id) });
          default: {
            if (!body.name || !body.url) return runError(400, "name_and_url_required");
            const connection = await mcp.saveMcpConnection({
              userId,
              id: body.id,
              name: body.name,
              url: body.url,
              transport: body.transport,
              secret: body.secret,
              headers: body.headers,
              enabled: body.enabled,
            });
            return runJson({ connection }, { status: body.id ? 200 : 201 });
          }
        }
      } catch (error) {
        return runError(400, "mcp_error", { message: errorMessage(error) });
      }
    },
  },

  discord: {
    GET: async ({ userId }) => {
      const link = await getDiscordLink(userId);
      return runJson({
        configured: Boolean(env.DISCORD_BOT_TOKEN),
        inviteUrl: env.DISCORD_INVITE_URL ?? null,
        link: link ? { username: link.discordUsername, linkedAt: link.createdAt } : null,
      });
    },
    POST: async ({ userId, locale }) => {
      if (!env.DISCORD_BOT_TOKEN) return runError(503, "discord_unconfigured");
      const limited = await limitRun(userId, "discord-code", 5);
      if (limited) return limited;
      return runJson(await createDiscordLinkCode(userId, locale));
    },
    DELETE: async ({ userId }) => {
      await unlinkDiscord(userId);
      return runJson({ link: null });
    },
  },
};

async function saveSkill({ request, userId }: RunRequestContext, requireId: boolean) {
  const { saveSkill: save, skillSchema } = await import("@deniai/run/agent/skills");
  const parsed = skillSchema.safeParse(await readJson(request));
  if (!parsed.success) return runError(400, "invalid_skill");
  if (requireId && !parsed.data.id) return runError(400, "id_required");
  try {
    const result = await save(userId, parsed.data);
    if (result.ok) return runJson({ skill: result.skill }, { status: requireId ? 200 : 201 });
    if (result.reason === "duplicate") return runError(400, "duplicate_skill");
    if (result.reason === "not_found") return runError(404, "skill_not_found");
    return runError(400, "invalid_skill");
  } catch (error) {
    return runError(400, "invalid_skill", { message: errorMessage(error) });
  }
}

const routes = Object.entries(handlers).map(([pattern, methods]) => ({
  parts: pattern.split("/"),
  methods,
}));

function match(path: string[]) {
  for (const route of routes) {
    if (route.parts.length !== path.length) continue;
    const params: string[] = [];
    if (
      route.parts.every((part, index) => {
        const value = path[index]!;
        if (part.startsWith(":")) {
          if (!/^[A-Za-z0-9_:.-]{1,200}$/.test(value)) return false;
          params.push(value);
          return true;
        }
        return part === value;
      })
    )
      return { methods: route.methods, params };
  }
  return null;
}

/** Entry point of `/api/run/<splat>`. */
export async function handleRunApi(request: Request, splat: string): Promise<Response> {
  const path = splat.split("/").filter(Boolean).map(decodeURIComponent);
  if (path.join("/") === "mcp/oauth/callback" && request.method === "GET") {
    const { handleMcpOAuthCallback } = await import("./mcp-oauth-callback");
    return handleMcpOAuthCallback(request);
  }
  const found = match(path);
  if (!found) return runError(404, "not_found");
  const method = request.method.toUpperCase() as Method;
  const handler = found.methods[method];
  if (!handler) return runError(405, "method_not_allowed");
  const context = await authenticateRun(request, { mutation: method !== "GET" });
  if (context instanceof Response) return context;
  try {
    return await handler(context, found.params);
  } catch (error) {
    const { isUsageLimitError } = await import("@deniai/run/billing/plans");
    if (isUsageLimitError(error)) return usageLimit(error);
    console.error("[run api]", request.method, path.join("/"), error);
    return runError(500, "internal_error");
  }
}
