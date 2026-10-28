import { createFileRoute } from "@tanstack/react-router";
import { POST } from "@/server/http/upload-attachment/route";

export const Route = createFileRoute("/api/upload-attachment")({
  server: {
    handlers: {
      POST: ({ request }) => POST(request),
    },
  },
});
