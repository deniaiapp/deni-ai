import { z } from "zod";
import { isAllowedAdOrigin } from "@/lib/ad-origin";
import { auth } from "@/lib/auth";
import { recordAdEvent, verifyAdDelivery } from "@/lib/ads";
import { isFreeAdViewer } from "@/lib/usage";
import { allowGuestAdBilling, anonymousAdViewerId } from "@/lib/ad-ip";
import { readRequestJson, RequestBodyTooLargeError } from "@/lib/request-body";

export async function POST(request: Request) {
  if (!isAllowedAdOrigin(request)) return new Response(null, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  const viewerId = session?.session?.userId ?? anonymousAdViewerId(request.headers);
  if (!viewerId) return new Response(null, { status: 401 });
  if (
    session?.session &&
    !session.user.isAnonymous &&
    !(await isFreeAdViewer(session.session.userId))
  )
    return new Response(null, { status: 403 });
  let body: unknown;
  try {
    body = await readRequestJson(request, 4096);
  } catch (error) {
    return new Response(null, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  const input = z.object({ id: z.string().uuid(), token: z.string() }).safeParse(body);
  if (!input.success || !verifyAdDelivery(input.data.token, input.data.id, viewerId))
    return new Response(null, { status: 400 });
  const isGuest = !session?.session || Boolean(session.user.isAnonymous);
  if (!isGuest || (await allowGuestAdBilling(request.headers, "view")))
    await recordAdEvent(input.data.id, viewerId, "view", isGuest);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
