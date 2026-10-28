import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ads/")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/server/http/ads/route")).GET(request),
    },
  },
});
