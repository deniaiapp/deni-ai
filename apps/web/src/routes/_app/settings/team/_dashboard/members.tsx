import { createFileRoute } from "@tanstack/react-router";
import { TeamMembersPage } from "@/components/team/team-members-page";

export const Route = createFileRoute("/_app/settings/team/_dashboard/members")({
  component: TeamMembersPage,
});
