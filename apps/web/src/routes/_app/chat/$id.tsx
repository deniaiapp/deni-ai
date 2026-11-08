import { createFileRoute } from "@tanstack/react-router";
import { ChatInterfaceSkeleton } from "@/components/chat/chat-interface-skeleton";

/**
 * Thin route marker for /chat/$id. Real UI lives in ChatRouteHost (AppShell),
 * which reuses mounted panes and the tRPC cache when switching chats.
 */
export const Route = createFileRoute("/_app/chat/$id")({
  pendingComponent: ChatInterfaceSkeleton,
  component: () => null,
});
