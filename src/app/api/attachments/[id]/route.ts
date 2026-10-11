import { headers } from "next/headers";
import { isAttachmentId } from "@/lib/attachment-url";
import { findReadyAttachmentKey } from "@/lib/attachments";
import { auth } from "@/lib/auth";
import { ATTACHMENT_VIEW_URL_TTL_SECONDS, signAttachmentUrl } from "@/lib/upload";

// The signed URL in the redirect is a bearer credential: never cache it in a
// shared cache, and never pass the app URL on to the storage host.
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
} as const;

function emptyResponse(status: number) {
  return new Response(null, { status, headers: PRIVATE_HEADERS });
}

/**
 * Redirect the owner of a stored attachment to a short-lived signed URL. Any
 * other id, including someone else's, answers 404 so existence is not revealed.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.session) return emptyResponse(401);

  const { id } = await params;
  if (!isAttachmentId(id)) return emptyResponse(404);
  const key = await findReadyAttachmentKey(id, session.session.userId);
  if (!key) return emptyResponse(404);

  let location: string;
  try {
    location = await signAttachmentUrl(key, ATTACHMENT_VIEW_URL_TTL_SECONDS);
  } catch (error) {
    console.error("[attachments] Failed to sign an attachment URL", error);
    return emptyResponse(503);
  }
  return new Response(null, { status: 302, headers: { ...PRIVATE_HEADERS, Location: location } });
}

export const HEAD = GET;
