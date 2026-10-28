import { createFileRoute } from "@tanstack/react-router";
import { GET } from "@/server/http/well-known/change-password";

export const Route = createFileRoute("/.well-known/change-password")({
  server: {
    handlers: {
      GET: () => GET(),
    },
  },
});
