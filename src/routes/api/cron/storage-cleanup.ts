import { createFileRoute } from "@tanstack/react-router";
import { GET } from "@/server/http/cron/storage-cleanup/route";

export const Route = createFileRoute("/api/cron/storage-cleanup")({
  server: {
    handlers: {
      GET: ({ request }) => GET(request),
    },
  },
});
