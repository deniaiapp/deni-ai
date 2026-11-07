import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/auth/api";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/jobs/notifications";
import { getExtracted } from "@/i18n/server";

async function GET({ request: req }: { request: Request }) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const unreadOnly = new URL(req.url).searchParams.get("unread") === "1";
  return Response.json({ notifications: await listNotifications(userId, { unreadOnly }) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

async function PATCH({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json().catch(() => ({}))) as { id?: string; read?: boolean; all?: boolean };
  if (body.all) {
    await markAllNotificationsRead(userId);
    return Response.json({ ok: true });
  }
  if (!body.id) return Response.json({ error: t("ID is required") }, { status: 400 });
  const notification = await markNotificationRead(userId, body.id, body.read !== false);
  if (!notification) return Response.json({ error: t("Notification not found") }, { status: 404 });
  return Response.json({ notification });
}

export const Route = createFileRoute("/api/notifications")({
  server: { handlers: { GET, PATCH } },
});
