import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ads/campaigns/$id")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) =>
        (await import("@/server/http/ads/campaigns/[id]/route")).PATCH(request, { params }),
    },
  },
});
