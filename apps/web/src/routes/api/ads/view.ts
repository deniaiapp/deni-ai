import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ads/view")({
  server: {
    handlers: {
      POST: async ({ request }) => (await import("@/server/http/ads/view/route")).POST(request),
    },
  },
});
