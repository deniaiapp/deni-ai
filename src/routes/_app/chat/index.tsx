import { createFileRoute } from "@tanstack/react-router";
import { ChatInterfaceSkeleton } from "@/components/chat/chat-interface-skeleton";

/**
 * Thin route marker. Chat UI is hosted client-side by ChatRouteHost in AppShell
 * so navigations to /chat keep the shell and loaded panes mounted.
 */
export const Route = createFileRoute("/_app/chat/")({
  pendingComponent: ChatInterfaceSkeleton,
  component: () => null,
});
