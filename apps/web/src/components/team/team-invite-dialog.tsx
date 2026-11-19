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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@deniai/ui/components/select";
import { Spinner } from "@deniai/ui/components/spinner";

export function TeamInviteDialog({
  open,
  onOpenChange,
  email,
  onEmailChange,
  role,
  onRoleChange,
  onInvite,
  isInviting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  onEmailChange: (value: string) => void;
  role: string;
  onRoleChange: (value: string) => void;
  onInvite: () => void;
  isInviting: boolean;
}) {
  const t = useExtracted();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Invite Member")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("Email")}</Label>
            <Input
              type="email"
              placeholder="colleague@example.com"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  onInvite();
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("Role")}</Label>
            <Select
              value={role}
              onValueChange={(value) => {
                if (value !== null) onRoleChange(value);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{t("Member")}</SelectItem>
                <SelectItem value="admin">{t("Admin")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(
              "When this invitation is accepted, the member joins your team immediately and your billed seat count may change.",
            )}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button onClick={onInvite} disabled={isInviting || !email.trim()}>
            {isInviting && <Spinner className="size-3.5" />}
            {t("Send Invitation")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
