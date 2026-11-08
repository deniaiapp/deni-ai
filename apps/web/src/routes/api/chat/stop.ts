import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/stop")({
  server: {
    handlers: {
      POST: async ({ request }) => (await import("@/server/http/chat/stop/route")).POST(request),
    },
  },
});
