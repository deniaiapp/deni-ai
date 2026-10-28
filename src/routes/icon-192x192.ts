import { createFileRoute } from "@tanstack/react-router";
import { pwaIconResponse } from "@/server/http/pwa-icon";

export const Route = createFileRoute("/icon-192x192")({
  server: {
    handlers: {
      GET: () => pwaIconResponse("192x192"),
    },
  },
});
