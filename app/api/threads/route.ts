import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { createGroup } from "@/lib/groups";
import { z } from "zod";
import { validAvatarIcon } from "@/lib/avatar";
import { getExtracted } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const parsed = z.object({ title: z.string().trim().max(120).optional(), botIds: z.array(z.string().min(1)).min(2).max(50), icon: z.custom<string | null>(validAvatarIcon).optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: t("Choose at least two teammates and a valid group name/icon.") }, { status: 400 });
  const result = await createGroup(userId, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: t("Choose at least two valid teammates.") }, { status: 400 });
  }
  return NextResponse.json({ thread: result.thread });
}
