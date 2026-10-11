import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { limitOrResponse } from "@/lib/rate-limit";
import { createTeammate } from "@/lib/teammates";
import { usageLimitPayload } from "@/lib/usage";
import { getExtracted } from "next-intl/server";
import { localizeUsageLimit } from "@/lib/localize-error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "bots", 20);
  if (limited) return limited;
  const body = (await req.json()) as {
    name?: string;
    job?: string;
    instructions?: string;
    icon?: string | null;
  };
  const result = await createTeammate(userId, body);
  if (!result.ok) {
    if (result.reason === "invalid_icon") return NextResponse.json({ error: t("Invalid icon") }, { status: 400 });
    if (result.reason === "name_required") return NextResponse.json({ error: t("Name is required.") }, { status: 400 });
    return NextResponse.json({ ...usageLimitPayload(result.error), error: await localizeUsageLimit(userId, result.error) }, { status: 402 });
  }
  return NextResponse.json({ bot: result.bot, thread: result.thread });
}
