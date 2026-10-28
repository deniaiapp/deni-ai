import { createFileRoute } from "@tanstack/react-router";
import { GET } from "@/server/http/ads/route";

export const Route = createFileRoute("/api/ads/")({
  server: {
    handlers: {
      GET: ({ request }) => GET(request),
    },
  },
});
