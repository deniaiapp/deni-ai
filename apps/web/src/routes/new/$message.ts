import { createFileRoute } from "@tanstack/react-router";
import { signInPath } from "@/lib/sign-in-redirect";

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

async function handleNewChat(request: Request, message: string) {
  if (!isDocumentNavigation(request)) {
    return Response.json({ error: "Navigation required" }, { status: 400 });
  }

  try {
    const { createChatFromRequest } = await import("@/server/chat-manager");
    const chatId = await createChatFromRequest(request.headers);
    const baseUrl = new URL(request.url);

    const webSearch = baseUrl.searchParams.get("webSearch");
    const redirectParams = new URLSearchParams([
      ["message", message],
      ...(webSearch === "true" ? [["webSearch", "true"]] : []),
    ]);

    const redirectUrl = new URL(`/chat/${chatId}?${redirectParams.toString()}`, baseUrl.origin);
    return Response.redirect(redirectUrl, 307);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        // Signed-out visitors (shared links, the SearchAction) sign in and come back.
        const { pathname, search } = new URL(request.url);
        return Response.redirect(new URL(signInPath(`${pathname}${search}`), request.url), 307);
      }
    }
    console.error("[GET /new/$message] Error creating chat:", error);
    return Response.json({ error: "Failed to create chat" }, { status: 500 });
  }
}

export const Route = createFileRoute("/new/$message")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleNewChat(request, params.message),
    },
  },
});
