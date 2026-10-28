import { createFileRoute } from "@tanstack/react-router";
import { GET, HEAD } from "@/server/http/attachments/[id]/route";

export const Route = createFileRoute("/api/attachments/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => GET(request, { params }),
      HEAD: ({ request, params }) => HEAD(request, { params }),
    },
  },
});
