import { createFileRoute } from "@tanstack/react-router";
import { GET } from "@/server/http/status/models/route";

export const Route = createFileRoute("/api/status/models")({
  server: {
    handlers: {
      GET: () => GET(),
    },
  },
});
