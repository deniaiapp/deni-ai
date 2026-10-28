import { createFileRoute } from "@tanstack/react-router";
import { GET } from "@/server/http/metadata/robots";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => GET(),
    },
  },
});
