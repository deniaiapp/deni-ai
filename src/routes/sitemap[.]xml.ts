import { createFileRoute } from "@tanstack/react-router";
import { GET } from "@/server/http/metadata/sitemap";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => GET(),
    },
  },
});
