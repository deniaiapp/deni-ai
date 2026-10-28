import { createFileRoute } from "@tanstack/react-router";
import { TeamAuditLogPage } from "@/components/team/team-audit-log-page";

export const Route = createFileRoute("/_app/settings/team/_dashboard/audit-log")({
  component: TeamAuditLogPage,
});
