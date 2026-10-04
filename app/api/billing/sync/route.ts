import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { syncBilling } from "@/lib/billing";
import { stripeConfigured } from "@/lib/stripe";
import { getUsageSnapshot } from "@/lib/usage";
import { getExtracted } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  if (!stripeConfigured()) {
    return NextResponse.json({ error: t("Billing is not configured yet") }, { status: 501 });
  }
  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  const sessionId = body.sessionId?.trim() || null;
  await syncBilling(userId, sessionId);
  return NextResponse.json({ usage: await getUsageSnapshot(userId) });
}
