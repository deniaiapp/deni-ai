import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/trpc/$")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/server/http/trpc/[trpc]/route")).GET(request),
      POST: async ({ request }) => (await import("@/server/http/trpc/[trpc]/route")).POST(request),
    },
  },
});
