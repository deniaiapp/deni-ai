import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ads/click")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/server/http/ads/click/route")).GET(request),
    },
  },
});
