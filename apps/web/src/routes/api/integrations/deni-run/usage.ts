import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/integrations/deni-run/usage")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await import("@/server/http/integrations/deni-run/usage/route")).GET(request),
      POST: async ({ request }) =>
        (await import("@/server/http/integrations/deni-run/usage/route")).POST(request),
    },
  },
});
