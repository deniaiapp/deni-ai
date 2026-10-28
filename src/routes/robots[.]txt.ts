import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => (await import("@/server/http/metadata/robots")).GET(),
    },
  },
});
