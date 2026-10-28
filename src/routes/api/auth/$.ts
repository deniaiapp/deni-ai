import { createFileRoute } from "@tanstack/react-router";
import { GET, POST } from "@/server/http/auth/[...all]/route";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => GET(request),
      POST: ({ request }) => POST(request),
    },
  },
});
