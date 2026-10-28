import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/model-health")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await import("@/server/http/cron/model-health/route")).GET(request),
    },
  },
});
