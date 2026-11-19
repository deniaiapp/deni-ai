import { useExtracted } from "use-intl";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@deniai/ui/components/dialog";
import { Button } from "@deniai/ui/components/button";
import { Input } from "@deniai/ui/components/input";
import { Label } from "@deniai/ui/components/label";
import { Spinner } from "@deniai/ui/components/spinner";

export function TeamCreateDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  onCreate,
  isCreating,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (value: string) => void;
  onCreate: () => void;
  isCreating: boolean;
}) {
  const t = useExtracted();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Create Team")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("Team Name")}</Label>
            <Input
              placeholder={t("e.g. Acme Corp")}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  onCreate();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button onClick={onCreate} disabled={isCreating || !name.trim()}>
            {isCreating && <Spinner className="size-3.5" />}
            {t("Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
