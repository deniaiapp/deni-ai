import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/attachments/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        (await import("@/server/http/attachments/[id]/route")).GET(request, { params }),
      HEAD: async ({ request, params }) =>
        (await import("@/server/http/attachments/[id]/route")).HEAD(request, { params }),
    },
  },
});
