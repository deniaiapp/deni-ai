import { TeamInviteDialog } from "./team-invite-dialog";
import { TeamMembersList } from "./team-members-list";
import { TeamPendingInvitations } from "./team-pending-invitations";
import { TeamRemoveMemberDialog } from "./team-remove-member-dialog";
import { useTeamSettingsContext } from "./team-settings-context";

export function TeamMembersPage() {
  const {
    members,
    reloadMembers,
    isReloadingMembers,
    isMembersReloadCoolingDown,
    pendingInvitations,
    isAdmin,
    isInviteDialogOpen,
    setIsInviteDialogOpen,
    inviteEmail,
    setInviteEmail,
    inviteRole,
    setInviteRole,
    isInviting,
    memberToRemove,
    setMemberToRemove,
    isRemovingMember,
    updatingMemberRoleId,
    handleInvite,
    handleRemoveMember,
    handleUpdateMemberRole,
    handleCancelInvitation,
  } = useTeamSettingsContext();

  return (
    <div className="flex flex-col gap-4">
      <TeamMembersList
        members={members}
        isAdmin={isAdmin}
        updatingMemberRoleId={updatingMemberRoleId}
        onInviteClick={() => setIsInviteDialogOpen(true)}
        onRemoveClick={setMemberToRemove}
        onRoleChange={handleUpdateMemberRole}
        onReload={reloadMembers}
        isReloading={isReloadingMembers}
        isReloadDisabled={isReloadingMembers || isMembersReloadCoolingDown}
      />

      <TeamPendingInvitations
        invitations={pendingInvitations}
        isAdmin={isAdmin}
        onCancel={handleCancelInvitation}
      />

      <TeamInviteDialog
        open={isInviteDialogOpen}
        onOpenChange={setIsInviteDialogOpen}
        email={inviteEmail}
        onEmailChange={setInviteEmail}
        role={inviteRole}
        onRoleChange={setInviteRole}
        onInvite={handleInvite}
        isInviting={isInviting}
      />

      <TeamRemoveMemberDialog
        member={memberToRemove}
        onOpenChange={(open) => {
          if (!open) setMemberToRemove(null);
        }}
        onConfirm={handleRemoveMember}
        isRemoving={isRemovingMember}
      />
    </div>
  );
}
