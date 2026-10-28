import { createFileRoute } from "@tanstack/react-router";
import { POST } from "@/server/http/ads/view/route";

export const Route = createFileRoute("/api/ads/view")({
  server: {
    handlers: {
      POST: ({ request }) => POST(request),
    },
  },
});
