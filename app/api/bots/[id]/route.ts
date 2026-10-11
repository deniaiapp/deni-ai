import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { deleteTeammate, updateTeammate } from "@/lib/teammates";
import { getExtracted } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = await params;
  const body = (await req.json()) as {
    name?: string;
    job?: string;
    instructions?: string;
    icon?: string | null;
  };
  const result = await updateTeammate(userId, id, body);
  if (!result.ok) {
    if (result.reason === "invalid_icon") return NextResponse.json({ error: t("Invalid icon") }, { status: 400 });
    return NextResponse.json({ error: t("Teammate not found") }, { status: 404 });
  }
  return NextResponse.json({ bot: result.bot });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = await params;
  const result = await deleteTeammate(userId, id);
  if (!result.ok) {
    return NextResponse.json({ error: t("Default teammates cannot be deleted") }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
