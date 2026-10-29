import { createFileRoute } from "@tanstack/react-router";
import { TeamDomainsPage } from "@/components/team/team-domains-page";

export const Route = createFileRoute("/_app/settings/team/_dashboard/domains")({
  component: TeamDomainsPage,
});
