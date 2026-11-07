import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/auth/api";
import { createGroup } from "@/lib/chat/groups";
import { z } from "zod";
import { validAvatarIcon } from "@/lib/teammates/avatar";
import { getExtracted } from "@/i18n/server";

async function POST({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const parsed = z.object({ title: z.string().trim().max(120).optional(), botIds: z.array(z.string().min(1)).min(2).max(50), icon: z.custom<string | null>(validAvatarIcon).optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: t("Choose at least two teammates and a valid group name/icon.") }, { status: 400 });
  const result = await createGroup(userId, parsed.data);
  if (!result.ok) {
    return Response.json({ error: t("Choose at least two valid teammates.") }, { status: 400 });
  }
  return Response.json({ thread: result.thread });
}

export const Route = createFileRoute("/api/threads/")({
  server: { handlers: { POST } },
});
