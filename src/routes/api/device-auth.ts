import { createFileRoute } from "@tanstack/react-router";
import { POST } from "@/server/http/device-auth/route";

export const Route = createFileRoute("/api/device-auth")({
  server: {
    handlers: {
      POST: ({ request }) => POST(request),
    },
  },
});
