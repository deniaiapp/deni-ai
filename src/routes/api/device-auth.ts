import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/device-auth")({
  server: {
    handlers: {
      POST: async ({ request }) => (await import("@/server/http/device-auth/route")).POST(request),
    },
  },
});
