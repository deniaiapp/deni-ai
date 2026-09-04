import { NextResponse } from "next/server";
import { unauthorizedResponse } from "@/lib/api-auth";
import { getAuthSession } from "@/lib/auth";
import { limitOrResponse } from "@/lib/rate-limit";
import { appUrl, getStripe, proPriceId, stripeConfigured } from "@/lib/stripe";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sessionUser = await getAuthSession();
  if (!sessionUser) return unauthorizedResponse();
  const userId = sessionUser.user.id;
  const limited = await limitOrResponse(userId, "checkout", 8);
  if (limited) return limited;
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Billing is not configured yet" }, { status: 501 });
  }

  const email = sessionUser.user.email;
  const store = await readStore(userId);
  const storeCustomer = store.billing?.stripeCustomerId ?? null;

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: proPriceId(), quantity: 1 }],
    success_url: `${appUrl(req)}/upgrade?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl(req)}/upgrade`,
    client_reference_id: userId,
    customer: storeCustomer || undefined,
    customer_email: storeCustomer ? undefined : email,
    metadata: { userId },
    subscription_data: { metadata: { userId } },
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: session.url });
}
