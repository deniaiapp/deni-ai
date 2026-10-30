import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/usage-and-meter")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await import("@/server/http/cron/usage-and-meter/route")).GET(request),
    },
  },
});
