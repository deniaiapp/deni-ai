import { createFileRoute } from "@tanstack/react-router";
import { TeamHomePage } from "@/components/team/team-home-page";

export const Route = createFileRoute("/_app/settings/team/_dashboard/")({
  component: TeamHomePage,
});
