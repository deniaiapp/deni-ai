import { createFileRoute } from "@tanstack/react-router";
import { GET } from "@/server/http/metadata/manifest";

export const Route = createFileRoute("/manifest.webmanifest")({
  server: {
    handlers: {
      GET: () => GET(),
    },
  },
});
