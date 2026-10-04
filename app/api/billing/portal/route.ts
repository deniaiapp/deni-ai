import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { appUrl, getStripe, stripeConfigured } from "@/lib/stripe";
import { readStore } from "@/lib/store";
import { getExtracted } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  if (!stripeConfigured()) {
    return NextResponse.json({ error: t("Billing is not configured yet") }, { status: 501 });
  }
  const store = await readStore(userId);
  const customerId = store.billing?.stripeCustomerId;
  if (!customerId) {
    return NextResponse.json({ error: t("No billing account yet") }, { status: 400 });
  }
  const portal = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: appUrl(req),
  });
  return NextResponse.json({ url: portal.url });
}
