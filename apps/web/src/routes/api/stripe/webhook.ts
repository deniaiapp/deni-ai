import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await import("@/server/http/stripe/webhook/route")).POST(request),
    },
  },
});
