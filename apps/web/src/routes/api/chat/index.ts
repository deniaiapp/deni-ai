import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/")({
  server: {
    handlers: {
      POST: async ({ request }) => (await import("@/server/http/chat/route")).POST(request),
    },
  },
});
