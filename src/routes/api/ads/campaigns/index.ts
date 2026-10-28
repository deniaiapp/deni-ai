import { createFileRoute } from "@tanstack/react-router";
import { GET, POST } from "@/server/http/ads/campaigns/route";

export const Route = createFileRoute("/api/ads/campaigns/")({
  server: {
    handlers: {
      GET: ({ request }) => GET(request),
      POST: ({ request }) => POST(request),
    },
  },
});
