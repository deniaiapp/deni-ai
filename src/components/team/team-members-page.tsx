import { TeamInviteDialog } from "./team-invite-dialog";
import { TeamJoinRequests } from "./team-join-requests";
import { TeamMembersList } from "./team-members-list";
import { TeamPendingInvitations } from "./team-pending-invitations";
import { TeamRemoveMemberDialog } from "./team-remove-member-dialog";
import { useTeamSettingsContext } from "./team-settings-context";
import { TeamTransferOwnershipDialog } from "./team-transfer-ownership-dialog";

export function TeamMembersPage() {
  const {
    activeOrg,
    members,
    reloadMembers,
    isReloadingMembers,
    isMembersReloadCoolingDown,
    pendingInvitations,
    isAdmin,
    isOwner,
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
    memberToMakeOwner,
    setMemberToMakeOwner,
    isTransferringOwnership,
    handleTransferOwnership,
  } = useTeamSettingsContext();

  return (
    <div className="flex flex-col gap-4">
      <TeamMembersList
        members={members}
        isAdmin={isAdmin}
        isOwner={isOwner}
        updatingMemberRoleId={updatingMemberRoleId}
        onMakeOwnerClick={setMemberToMakeOwner}
        onInviteClick={() => setIsInviteDialogOpen(true)}
        onRemoveClick={setMemberToRemove}
        onRoleChange={handleUpdateMemberRole}
        onReload={reloadMembers}
        isReloading={isReloadingMembers}
        isReloadDisabled={isReloadingMembers || isMembersReloadCoolingDown}
      />

      {isAdmin && activeOrg && <TeamJoinRequests organizationId={activeOrg.id} />}

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

      <TeamTransferOwnershipDialog
        member={memberToMakeOwner}
        onOpenChange={(open) => {
          if (!open) setMemberToMakeOwner(null);
        }}
        onConfirm={handleTransferOwnership}
        isTransferring={isTransferringOwnership}
      />
    </div>
  );
}
