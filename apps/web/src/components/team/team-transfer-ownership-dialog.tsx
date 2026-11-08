import { useExtracted } from "use-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@deniai/ui/components/alert-dialog";
import { Spinner } from "@deniai/ui/components/spinner";
import type { Member } from "./team-types";

export function TeamTransferOwnershipDialog({
  member,
  onOpenChange,
  onConfirm,
  isTransferring,
}: {
  member: Member | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isTransferring: boolean;
}) {
  const t = useExtracted();

  return (
    <AlertDialog
      open={!!member}
      onOpenChange={(open) => {
        if (isTransferring) return;
        onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Transfer ownership?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              "{name} becomes the owner and manages the team's subscription. You become an admin.",
              { name: member?.user.name || member?.user.email || "" },
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isTransferring}>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction disabled={isTransferring} onClick={onConfirm}>
            {isTransferring && <Spinner className="size-3.5" />}
            {t("Transfer ownership")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
