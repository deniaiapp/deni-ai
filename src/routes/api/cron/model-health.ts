import { createFileRoute } from "@tanstack/react-router";
import { GET } from "@/server/http/cron/model-health/route";

export const Route = createFileRoute("/api/cron/model-health")({
  server: {
    handlers: {
      GET: ({ request }) => GET(request),
    },
  },
});
