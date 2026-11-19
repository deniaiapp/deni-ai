import { createFileRoute } from "@tanstack/react-router";
import { RunNotificationsPage } from "@/components/run/run-notifications-page";

export const Route = createFileRoute("/_app/run/notifications")({
  component: RunNotificationsPage,
});
