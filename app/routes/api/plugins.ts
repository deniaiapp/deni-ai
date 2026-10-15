import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { disconnectPlugin, pluginKinds, pluginStatus, setPluginAlwaysAllow, writeActions } from "@/lib/builtin-plugins";
import { limitOrResponse } from "@/lib/rate-limit";
import { getExtracted } from "@/i18n/server";
import { localizeError } from "@/lib/localize-error";

async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  return Response.json({ plugins: await pluginStatus(userId) }, { headers: { "Cache-Control": "no-store" } });
}

async function POST({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = await req.json().catch(() => null) as { kind?: string; action?: string; enabled?: boolean } | null;
  if (!body || !pluginKinds.includes(body.kind as (typeof pluginKinds)[number]) || !writeActions.includes(body.action as (typeof writeActions)[number]) || typeof body.enabled !== "boolean") {
    return Response.json({ error: t("Invalid permission") }, { status: 400 });
  }
  try {
    await setPluginAlwaysAllow(userId, body.kind as (typeof pluginKinds)[number], body.action as (typeof writeActions)[number], body.enabled);
    return Response.json({ plugins: await pluginStatus(userId) });
  } catch (error) {
    return Response.json({ error: await localizeError(error, t("Unable to change permission")) }, { status: 400 });
  }
}

async function DELETE({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "plugin-disconnect", 20);
  if (limited) return limited;
  const body = await req.json().catch(() => null) as { kind?: string } | null;
  if (!body || !pluginKinds.includes(body.kind as (typeof pluginKinds)[number])) {
    return Response.json({ error: t("Invalid plugin") }, { status: 400 });
  }
  try {
    return Response.json({ plugins: await disconnectPlugin(userId, body.kind as (typeof pluginKinds)[number]) });
  } catch (error) {
    return Response.json({ error: await localizeError(error, t("Could not disconnect plugin.")) }, { status: 502 });
  }
}

export const Route = createFileRoute("/api/plugins")({
  server: { handlers: { GET, POST, DELETE } },
});
