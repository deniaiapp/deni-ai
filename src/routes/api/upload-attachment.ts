import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/upload-attachment")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await import("@/server/http/upload-attachment/route")).POST(request),
    },
  },
});
