import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/status/models")({
  server: {
    handlers: {
      GET: async () => (await import("@/server/http/status/models/route")).GET(),
    },
  },
});
