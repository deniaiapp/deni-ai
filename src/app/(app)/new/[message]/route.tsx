import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { signInPath } from "@/lib/sign-in-redirect";
import { createChatFromRequest } from "@/server/chat-manager";

/**
 * Each GET creates a chat, so only top-level navigations may do it: not
 * prefetches/prerenders, subresources (`<img src>`), iframes or fetch(). Browsers
 * without Fetch Metadata send none of these headers and are allowed.
 */
function isDocumentNavigation(request: Request) {
  const dest = request.headers.get("sec-fetch-dest");
  const mode = request.headers.get("sec-fetch-mode");
  const purpose = `${request.headers.get("sec-purpose") ?? ""} ${request.headers.get("purpose") ?? ""}`;
  return (
    request.method === "GET" &&
    (dest === null || dest === "document") &&
    (mode === null || mode === "navigate") &&
    !purpose.toLowerCase().includes("prefetch")
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ message: string }> }) {
  if (!isDocumentNavigation(request)) {
    return NextResponse.json({ error: "Navigation required" }, { status: 400 });
  }

  try {
    const headersPromise = headers();
    const paramsPromise = params;

    const headersList = await headersPromise;
    const chatPromise = createChatFromRequest(headersList);
    const resolvedParams = await paramsPromise;
    const chatId = await chatPromise;
    const baseUrl = new URL(request.url);

    const webSearch = baseUrl.searchParams.get("webSearch");
    const redirectParams = new URLSearchParams([
      ["message", resolvedParams.message],
      ...(webSearch === "true" ? [["webSearch", "true"]] : []),
    ]);

    const redirectUrl = new URL(`/chat/${chatId}?${redirectParams.toString()}`, baseUrl.origin);
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        // Signed-out visitors (shared links, the SearchAction) sign in and come back.
        const { pathname, search } = new URL(request.url);
        return NextResponse.redirect(new URL(signInPath(`${pathname}${search}`), request.url));
      }
    }
    console.error("[GET /new/[message]] Error creating chat:", error);
    return NextResponse.json({ error: "Failed to create chat" }, { status: 500 });
  }
}
