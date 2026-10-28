import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/icon-192x192")({
  server: {
    handlers: {
      GET: async () => (await import("@/server/http/pwa-icon")).pwaIconResponse("192x192"),
    },
  },
});
