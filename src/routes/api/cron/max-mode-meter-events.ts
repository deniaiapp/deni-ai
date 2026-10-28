import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/max-mode-meter-events")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await import("@/server/http/cron/max-mode-meter-events/route")).GET(request),
    },
  },
});
