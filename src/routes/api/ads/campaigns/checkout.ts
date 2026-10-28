import { createFileRoute } from "@tanstack/react-router";
import { POST } from "@/server/http/ads/campaigns/checkout/route";

export const Route = createFileRoute("/api/ads/campaigns/checkout")({
  server: {
    handlers: {
      POST: ({ request }) => POST(request),
    },
  },
});
