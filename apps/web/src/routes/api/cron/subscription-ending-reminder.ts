import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/subscription-ending-reminder")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await import("@/server/http/cron/subscription-ending-reminder/route")).GET(request),
    },
  },
});
