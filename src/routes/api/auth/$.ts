import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/server/http/auth/[...all]/route")).GET(request),
      POST: async ({ request }) =>
        (await import("@/server/http/auth/[...all]/route")).POST(request),
    },
  },
});
