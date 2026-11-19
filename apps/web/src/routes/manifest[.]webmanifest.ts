import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/manifest.webmanifest")({
  server: {
    handlers: {
      GET: async () => (await import("@/server/http/metadata/manifest")).GET(),
    },
  },
});
