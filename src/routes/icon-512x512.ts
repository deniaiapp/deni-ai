import { createFileRoute } from "@tanstack/react-router";
import { pwaIconResponse } from "@/server/http/pwa-icon";

export const Route = createFileRoute("/icon-512x512")({
  server: {
    handlers: {
      GET: () => pwaIconResponse("512x512"),
    },
  },
});
