import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { hasApiKey } from "@/lib/config";
import { mutateStore } from "@/lib/store";
import { encryptSecret } from "@/lib/secrets";
import { limitOrResponse } from "@/lib/rate-limit";
import { getExtracted } from "next-intl/server";
import { localizeError } from "@/lib/localize-error";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  return NextResponse.json({ ok: await hasApiKey(userId) });
}

export async function POST(req: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "setup", 10);
  if (limited) return limited;
  const body = (await req.json()) as { apiKey?: string; timezone?: string };
  const apiKey = body.apiKey?.trim() ?? "";
  if (!apiKey) {
    return NextResponse.json({ error: t("API key is required") }, { status: 400 });
  }
  try {
    const encryptedApiKey = encryptSecret(apiKey);
    await mutateStore(userId, (store) => {
      store.config.apiKey = encryptedApiKey;
      if (body.timezone) store.config.timezone = body.timezone;
    });
  } catch (error) {
    return NextResponse.json(
      { error: await localizeError(error, t("Unable to save API key")) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
