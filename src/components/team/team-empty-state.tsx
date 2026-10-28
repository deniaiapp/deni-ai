import { Plus, Users } from "lucide-react";
import { useExtracted } from "use-intl";
import type { ReactNode } from "react";
import { SettingsPageShell } from "@/components/settings-page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TeamCreateDialog } from "./team-create-dialog";

export function TeamEmptyState({
  isCreateDialogOpen,
  onCreateDialogOpenChange,
  newOrgName,
  onNewOrgNameChange,
  onCreate,
  isCreating,
  topSlot,
}: {
  isCreateDialogOpen: boolean;
  onCreateDialogOpenChange: (open: boolean) => void;
  newOrgName: string;
  onNewOrgNameChange: (value: string) => void;
  onCreate: () => void;
  isCreating: boolean;
  topSlot?: ReactNode;
}) {
  const t = useExtracted();

  return (
    <SettingsPageShell
      title={t("Team")}
      description={t("Create a team to share Pro access with your members.")}
    >
      {topSlot}
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
            <Users className="size-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-medium">{t("No team yet")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Create your first team to get started with team billing.")}
          </p>
          <Button className="mt-4" onClick={() => onCreateDialogOpenChange(true)}>
            <Plus className="size-4" />
            {t("Create Team")}
          </Button>
        </CardContent>
      </Card>

      <TeamCreateDialog
        open={isCreateDialogOpen}
        onOpenChange={onCreateDialogOpenChange}
        name={newOrgName}
        onNameChange={onNewOrgNameChange}
        onCreate={onCreate}
        isCreating={isCreating}
      />
    </SettingsPageShell>
  );
}
