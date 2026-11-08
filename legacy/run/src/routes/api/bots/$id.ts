import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/auth/api";
import { deleteTeammate, updateTeammate } from "@/lib/teammates";
import { getExtracted } from "@/i18n/server";

async function PATCH({ request: req, params }: { request: Request; params: { id: string } }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = params;
  const body = (await req.json()) as {
    name?: string;
    job?: string;
    instructions?: string;
    icon?: string | null;
  };
  const result = await updateTeammate(userId, id, body);
  if (!result.ok) {
    if (result.reason === "invalid_icon") return Response.json({ error: t("Invalid icon") }, { status: 400 });
    return Response.json({ error: t("Teammate not found") }, { status: 404 });
  }
  return Response.json({ bot: result.bot });
}

async function DELETE({ params }: { params: { id: string } }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = params;
  const result = await deleteTeammate(userId, id);
  if (!result.ok) {
    return Response.json({ error: t("Default teammates cannot be deleted") }, { status: 400 });
  }
  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/bots/$id")({
  server: { handlers: { PATCH, DELETE } },
});
