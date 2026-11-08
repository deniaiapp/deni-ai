import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/storage-cleanup")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await import("@/server/http/cron/storage-cleanup/route")).GET(request),
    },
  },
});
