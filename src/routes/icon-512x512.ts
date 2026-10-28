import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/icon-512x512")({
  server: {
    handlers: {
      GET: async () => (await import("@/server/http/pwa-icon")).pwaIconResponse("512x512"),
    },
  },
});
