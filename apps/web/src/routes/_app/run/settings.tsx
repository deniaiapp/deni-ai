import { createFileRoute } from "@tanstack/react-router";
import { RunSettingsPage } from "@/components/run/run-settings-page";

export const Route = createFileRoute("/_app/run/settings")({
  component: RunSettingsPage,
});
