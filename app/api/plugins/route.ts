import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { disconnectPlugin, pluginKinds, pluginStatus, setPluginAlwaysAllow, writeActions } from "@/lib/builtin-plugins";
import { limitOrResponse } from "@/lib/rate-limit";
import { getExtracted } from "next-intl/server";
import { localizeError } from "@/lib/localize-error";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  return NextResponse.json({ plugins: await pluginStatus(userId) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = await req.json().catch(() => null) as { kind?: string; action?: string; enabled?: boolean } | null;
  if (!body || !pluginKinds.includes(body.kind as (typeof pluginKinds)[number]) || !writeActions.includes(body.action as (typeof writeActions)[number]) || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: t("Invalid permission") }, { status: 400 });
  }
  try {
    await setPluginAlwaysAllow(userId, body.kind as (typeof pluginKinds)[number], body.action as (typeof writeActions)[number], body.enabled);
    return NextResponse.json({ plugins: await pluginStatus(userId) });
  } catch (error) {
    return NextResponse.json({ error: await localizeError(error, t("Unable to change permission")) }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "plugin-disconnect", 20);
  if (limited) return limited;
  const body = await req.json().catch(() => null) as { kind?: string } | null;
  if (!body || !pluginKinds.includes(body.kind as (typeof pluginKinds)[number])) {
    return NextResponse.json({ error: t("Invalid plugin") }, { status: 400 });
  }
  try {
    return NextResponse.json({ plugins: await disconnectPlugin(userId, body.kind as (typeof pluginKinds)[number]) });
  } catch (error) {
    return NextResponse.json({ error: await localizeError(error, t("Could not disconnect plugin.")) }, { status: 502 });
  }
}
