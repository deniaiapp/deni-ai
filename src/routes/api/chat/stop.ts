import { createFileRoute } from "@tanstack/react-router";
import { POST } from "@/server/http/chat/stop/route";

export const Route = createFileRoute("/api/chat/stop")({
  server: {
    handlers: {
      POST: ({ request }) => POST(request),
    },
  },
});
