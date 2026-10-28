import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useExtracted } from "use-intl";
import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { TeamEmptyState } from "@/components/team/team-empty-state";
import { TeamReceivedInvitations } from "@/components/team/team-received-invitations";
import { TeamShell } from "@/components/team/team-shell";
import {
  TeamSettingsProvider,
  useTeamSettingsContext,
} from "@/components/team/team-settings-context";

export const Route = createFileRoute("/_app/settings/team/_dashboard")({
  pendingComponent: TeamDashboardLoading,
  component: TeamDashboardLayout,
});

function TeamDashboardContent({ children }: { children: ReactNode }) {
  const t = useExtracted();
  const {
    isLoading,
    organizations,
    activeOrg,
    isCreateDialogOpen,
    setIsCreateDialogOpen,
    newOrgName,
    setNewOrgName,
    handleCreateOrg,
    isCreatingOrg,
    myPendingInvitations,
    respondingInvitationId,
    handleAcceptMyInvitation,
    handleRejectMyInvitation,
  } = useTeamSettingsContext();

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const receivedInvitations = (
    <TeamReceivedInvitations
      invitations={myPendingInvitations}
      respondingInvitationId={respondingInvitationId}
      onAccept={handleAcceptMyInvitation}
      onReject={handleRejectMyInvitation}
    />
  );

  if (organizations.length === 0 && !activeOrg) {
    return (
      <TeamEmptyState
        isCreateDialogOpen={isCreateDialogOpen}
        onCreateDialogOpenChange={setIsCreateDialogOpen}
        newOrgName={newOrgName}
        onNewOrgNameChange={setNewOrgName}
        onCreate={handleCreateOrg}
        isCreating={isCreatingOrg}
        topSlot={receivedInvitations}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t("Team")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Manage your team and team subscription.")}
        </p>
      </div>
      {receivedInvitations}
      <TeamShell>{children}</TeamShell>
    </div>
  );
}

function TeamDashboardLoading() {
  const t = useExtracted();
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center text-sm text-muted-foreground">
      {t("Loading team settings…")}
    </div>
  );
}

function TeamDashboardLayout() {
  return (
    <TeamSettingsProvider>
      <TeamDashboardContent>
        <Outlet />
      </TeamDashboardContent>
    </TeamSettingsProvider>
  );
}
