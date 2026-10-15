import { createFileRoute } from "@tanstack/react-router";
import { handleChat } from "@/lib/chat-route";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: ({ request }) => handleChat(request),
    },
  },
});
