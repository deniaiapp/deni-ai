import { Pencil } from "lucide-react";
import { useExtracted } from "use-intl";
import { useState } from "react";
import { Button } from "@deniai/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@deniai/ui/components/card";
import { Input } from "@deniai/ui/components/input";
import { Spinner } from "@deniai/ui/components/spinner";
import { TeamDeleteDialog } from "./team-delete-dialog";
import { TeamIconButton } from "./team-icon-button";
import { TeamLeaveDialog } from "./team-leave-dialog";
import { useTeamSettingsContext } from "./team-settings-context";
import { monthDayYearFormatter } from "./team-utils";

export function TeamHomePage() {
  const t = useExtracted();
  const {
    activeOrg,
    members,
    isAdmin,
    isOwner,
    isRoleLoading,
    orgNameDraft,
    setOrgNameDraft,
    isSavingOrgName,
    isSavingOrgLogo,
    handleUpdateOrgName,
    handleUpdateOrgLogo,
    handleRemoveOrgLogo,
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
    isDeletingOrg,
    handleDeleteOrg,
    isLeaveDialogOpen,
    setIsLeaveDialogOpen,
    isLeavingOrg,
    handleLeaveOrg,
  } = useTeamSettingsContext();
  const [isEditingName, setIsEditingName] = useState(false);

  if (!activeOrg) {
    return null;
  }

  if (isRoleLoading) {
    return (
      <div className="flex min-h-[20vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  async function saveName() {
    await handleUpdateOrgName();
    setIsEditingName(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="!pb-2">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <TeamIconButton
              logo={activeOrg.logo}
              isAdmin={isAdmin}
              isSaving={isSavingOrgLogo}
              onUpload={handleUpdateOrgLogo}
              onRemove={handleRemoveOrgLogo}
            />
            <div className="min-w-0 flex-1">
              {isEditingName ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    autoFocus
                    className="h-8 w-56"
                    value={orgNameDraft}
                    onChange={(event) => setOrgNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.nativeEvent.isComposing &&
                        event.keyCode !== 229
                      ) {
                        saveName();
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={isSavingOrgName || !orgNameDraft.trim()}
                    onClick={saveName}
                  >
                    {isSavingOrgName && <Spinner className="size-3.5" />}
                    {t("Save")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setIsEditingName(false)}>
                    {t("Cancel")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{activeOrg.name}</CardTitle>
                  {isAdmin && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      onClick={() => {
                        setOrgNameDraft(activeOrg.name);
                        setIsEditingName(true);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  )}
                </div>
              )}
              <CardDescription>
                {members.length} {members.length === 1 ? t("member") : t("members")}
                {activeOrg.slug && <span className="text-xs"> ({activeOrg.slug})</span>}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Team overview")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">{t("Members")}</p>
              <p className="mt-1 text-sm font-medium">{members.length}</p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">{t("Created")}</p>
              <p className="mt-1 text-sm font-medium">
                {monthDayYearFormatter.format(new Date(activeOrg.createdAt))}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {isOwner ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">{t("Danger Zone")}</CardTitle>
            <CardDescription>
              {t(
                "Deleting a team removes every member and cancels its subscription. This cannot be undone.",
              )}{" "}
              {t("To leave the team instead, transfer ownership to another member on Members.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => setIsDeleteDialogOpen(true)}>
              {t("Delete team")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">{t("Leave team")}</CardTitle>
            <CardDescription>
              {t("You lose access to this team and its shared projects.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => setIsLeaveDialogOpen(true)}>
              {t("Leave team")}
            </Button>
          </CardContent>
        </Card>
      )}

      <TeamLeaveDialog
        open={isLeaveDialogOpen}
        organizationName={activeOrg.name}
        onOpenChange={setIsLeaveDialogOpen}
        onConfirm={handleLeaveOrg}
        isLeaving={isLeavingOrg}
      />

      <TeamDeleteDialog
        open={isDeleteDialogOpen}
        organizationName={activeOrg.name}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={handleDeleteOrg}
        isDeleting={isDeletingOrg}
      />
    </div>
  );
}
