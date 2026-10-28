import { createFileRoute } from "@tanstack/react-router";
import { GET } from "@/server/http/ads/click/route";

export const Route = createFileRoute("/api/ads/click")({
  server: {
    handlers: {
      GET: ({ request }) => GET(request),
    },
  },
});
