import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/change-password")({
  server: {
    handlers: {
      GET: async () => (await import("@/server/http/well-known/change-password")).GET(),
    },
  },
});
