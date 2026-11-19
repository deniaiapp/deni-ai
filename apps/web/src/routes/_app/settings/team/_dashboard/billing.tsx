import { createFileRoute } from "@tanstack/react-router";
import { TeamBillingPage } from "@/components/team/team-billing-page";

export const Route = createFileRoute("/_app/settings/team/_dashboard/billing")({
  component: TeamBillingPage,
});
