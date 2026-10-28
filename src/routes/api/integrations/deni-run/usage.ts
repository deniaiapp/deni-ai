import { createFileRoute } from "@tanstack/react-router";
import { GET, POST } from "@/server/http/integrations/deni-run/usage/route";

export const Route = createFileRoute("/api/integrations/deni-run/usage")({
  server: {
    handlers: {
      GET: ({ request }) => GET(request),
      POST: ({ request }) => POST(request),
    },
  },
});
