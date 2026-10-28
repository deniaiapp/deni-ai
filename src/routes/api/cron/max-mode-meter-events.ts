import { createFileRoute } from "@tanstack/react-router";
import { GET } from "@/server/http/cron/max-mode-meter-events/route";

export const Route = createFileRoute("/api/cron/max-mode-meter-events")({
  server: {
    handlers: {
      GET: ({ request }) => GET(request),
    },
  },
});
