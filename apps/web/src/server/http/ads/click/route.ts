import { and, eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { adCampaign } from "@/db/schema";
import { isAllowedAdClickOrigin } from "@/lib/ad-origin";
import { auth } from "@/lib/auth";
import { adDeliveryStatus, adEligible, recordAdEvent } from "@/lib/ads";
import { isFreeAdViewer } from "@/lib/usage";
import { allowGuestAdBilling, anonymousAdViewerId } from "@/lib/ad-ip";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!isAllowedAdClickOrigin(request)) return new Response(null, { status: 403 });
  const id = url.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 404 });
  const session = await auth.api.getSession({ headers: request.headers });
  const viewerId = session?.session?.userId ?? anonymousAdViewerId(request.headers);
  if (!viewerId) return new Response(null, { status: 401 });
  if (
    session?.session &&
    !session.user.isAnonymous &&
    !(await isFreeAdViewer(session.session.userId))
  )
    return new Response(null, { status: 403 });
  const isGuest = !session?.session || Boolean(session.user.isAnonymous);
  const [ad] = await db
    .select()
    .from(adCampaign)
    .where(and(eq(adCampaign.id, id), adEligible(isGuest)))
    .limit(1);
  if (!ad || ad.userId === viewerId) return new Response(null, { status: 404 });
  // Never send a viewer to a newly edited URL that was not shown in their ad.
  const delivery = adDeliveryStatus(url.searchParams.get("token") ?? "", id, viewerId, ad.url);
  if (delivery === "invalid") return new Response(null, { status: 403 });
  const destination = new URL(ad.url);
  if (destination.protocol !== "https:") return new Response(null, { status: 404 });
  // A card left open past its billing window still opens the advertiser's site, unbilled.
  if (delivery === "valid" && (!isGuest || (await allowGuestAdBilling(request.headers, "click"))))
    await recordAdEvent(id, viewerId, "click", isGuest);
  return new Response(null, {
    status: 303,
    headers: {
      Location: destination.href,
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  });
}
