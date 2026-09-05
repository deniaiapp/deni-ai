import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const unreadOnly = new URL(req.url).searchParams.get("unread") === "1";
  return NextResponse.json({ notifications: await listNotifications(userId, { unreadOnly }) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json().catch(() => ({}))) as { id?: string; read?: boolean; all?: boolean };
  if (body.all) {
    await markAllNotificationsRead(userId);
    return NextResponse.json({ ok: true });
  }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const notification = await markNotificationRead(userId, body.id, body.read !== false);
  if (!notification) return NextResponse.json({ error: "notification not found" }, { status: 404 });
  return NextResponse.json({ notification });
}
