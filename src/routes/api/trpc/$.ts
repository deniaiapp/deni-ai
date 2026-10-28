import { createFileRoute } from "@tanstack/react-router";
import { GET, POST } from "@/server/http/trpc/[trpc]/route";

export const Route = createFileRoute("/api/trpc/$")({
  server: {
    handlers: {
      GET: ({ request }) => GET(request),
      POST: ({ request }) => POST(request),
    },
  },
});
