import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { limitOrResponse } from "@/lib/rate-limit";
import { createTeammate } from "@/lib/teammates";
import { usageLimitPayload } from "@/lib/usage";
import { getExtracted } from "@/i18n/server";
import { localizeUsageLimit } from "@/lib/localize-error";

async function POST({ request: req }: { request: Request }) {
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
    if (result.reason === "invalid_icon") return Response.json({ error: t("Invalid icon") }, { status: 400 });
    if (result.reason === "name_required") return Response.json({ error: t("Name is required.") }, { status: 400 });
    return Response.json({ ...usageLimitPayload(result.error), error: await localizeUsageLimit(userId, result.error) }, { status: 402 });
  }
  return Response.json({ bot: result.bot, thread: result.thread });
}

export const Route = createFileRoute("/api/bots/")({
  server: { handlers: { POST } },
});
