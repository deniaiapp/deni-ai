import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ads/campaigns/checkout")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await import("@/server/http/ads/campaigns/checkout/route")).POST(request),
    },
  },
});
