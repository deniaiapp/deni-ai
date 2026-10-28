import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ads/campaigns/")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/server/http/ads/campaigns/route")).GET(request),
      POST: async ({ request }) =>
        (await import("@/server/http/ads/campaigns/route")).POST(request),
    },
  },
});
