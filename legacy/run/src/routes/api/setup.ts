import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/auth/api";
import { hasApiKey } from "@/lib/data/config";
import { mutateStore } from "@/lib/data/store";
import { encryptSecret } from "@/lib/data/secrets";
import { limitOrResponse } from "@/lib/billing/rate-limit";
import { getExtracted } from "@/i18n/server";
import { localizeError } from "@/i18n/localize-error";

async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  return Response.json({ ok: await hasApiKey(userId) });
}

async function POST({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "setup", 10);
  if (limited) return limited;
  const body = (await req.json()) as { apiKey?: string; timezone?: string };
  const apiKey = body.apiKey?.trim() ?? "";
  if (!apiKey) {
    return Response.json({ error: t("API key is required") }, { status: 400 });
  }
  try {
    const encryptedApiKey = encryptSecret(apiKey);
    await mutateStore(userId, (store) => {
      store.config.apiKey = encryptedApiKey;
      if (body.timezone) store.config.timezone = body.timezone;
    });
  } catch (error) {
    return Response.json(
      { error: await localizeError(error, t("Unable to save API key")) },
      { status: 500 },
    );
  }
  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/setup")({
  server: { handlers: { GET, POST } },
});
