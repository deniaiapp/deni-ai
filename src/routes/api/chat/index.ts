import { createFileRoute } from "@tanstack/react-router";
import { POST } from "@/server/http/chat/route";

export const Route = createFileRoute("/api/chat/")({
  server: {
    handlers: {
      POST: ({ request }) => POST(request),
    },
  },
});
