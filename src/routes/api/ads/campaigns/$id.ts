import { createFileRoute } from "@tanstack/react-router";
import { PATCH } from "@/server/http/ads/campaigns/[id]/route";

export const Route = createFileRoute("/api/ads/campaigns/$id")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => PATCH(request, { params }),
    },
  },
});
