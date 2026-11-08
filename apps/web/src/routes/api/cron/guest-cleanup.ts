import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/guest-cleanup")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await import("@/server/http/cron/guest-cleanup/route")).GET(request),
    },
  },
});
