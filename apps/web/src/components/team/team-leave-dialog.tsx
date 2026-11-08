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

export function TeamLeaveDialog({
  open,
  organizationName,
  onOpenChange,
  onConfirm,
  isLeaving,
}: {
  open: boolean;
  organizationName: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isLeaving: boolean;
}) {
  const t = useExtracted();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (isLeaving) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Leave team?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              "You lose access to {name} and its shared projects. To join again, you need a new invitation.",
              { name: organizationName },
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLeaving}>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isLeaving}
            onClick={onConfirm}
          >
            {isLeaving && <Spinner className="size-3.5" />}
            {t("Leave team")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
