import { createFileRoute } from "@tanstack/react-router";
import { POST } from "@/server/http/stripe/webhook/route";

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => POST(request),
    },
  },
});
