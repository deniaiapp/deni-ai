import { Mail, TriangleAlert } from "lucide-react";
import { useSearchParams } from "@/lib/navigation";
import { useExtracted } from "use-intl";
import { useState } from "react";
import { usePlatformCapabilities } from "@/components/platform-capabilities-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc/react";
import { cn } from "@/lib/utils";
import type { ReceivedInvitation } from "./team-types";
import { useRoleLabel } from "./use-role-label";

function TeamAcceptInvitationDialog({
  invitation,
  onOpenChange,
  onConfirm,
}: {
  invitation: ReceivedInvitation | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (invitationId: string) => void;
}) {
  const t = useExtracted();
  const roleLabel = useRoleLabel();
  const { features } = usePlatformCapabilities();
  const impactQuery = trpc.organization.invitationBillingImpact.useQuery(
    { invitationId: invitation?.id ?? "" },
    { enabled: features.billing && invitation !== null, refetchOnWindowFocus: false, retry: false },
  );
  // If the check itself fails, warn anyway rather than let someone join unwarned.
  const cancelsPersonalSubscription =
    features.billing && (impactQuery.data?.cancelsPersonalSubscription ?? impactQuery.isError);

  return (
    <AlertDialog open={invitation !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("Join {team}?", { team: invitation?.organizationName ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            <p>
              {t("You will join this team as {role}.", {
                role: roleLabel(invitation?.role ?? "member"),
              })}
            </p>
            {cancelsPersonalSubscription && (
              <p className="mt-3 flex gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-left text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {t(
                  "Joining a team with an active team plan cancels your personal subscription immediately. Unused time is credited toward future invoices, not refunded.",
                )}
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!invitation || impactQuery.isLoading}
            onClick={() => {
              if (!invitation) return;
              onOpenChange(false);
              onConfirm(invitation.id);
            }}
          >
            {impactQuery.isLoading && <Spinner className="size-3.5" />}
            {t("Accept")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function TeamReceivedInvitations({
  invitations,
  respondingInvitationId,
  onAccept,
  onReject,
}: {
  invitations: ReceivedInvitation[];
  respondingInvitationId: string | null;
  onAccept: (invitationId: string) => void;
  onReject: (invitationId: string) => void;
}) {
  const t = useExtracted();
  const roleLabel = useRoleLabel();
  // The invitation an emailed link points at is only highlighted: accepting always
  // takes a click and the confirmation dialog.
  const linkedInvitationId = useSearchParams().get("invitationId");
  const [confirmingInvitation, setConfirmingInvitation] = useState<ReceivedInvitation | null>(null);

  if (invitations.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("Invitations for you")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {invitations.map((inv) => {
            const isResponding = respondingInvitationId === inv.id;
            return (
              <div
                key={inv.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3",
                  inv.id === linkedInvitationId && "border-primary ring-2 ring-primary/20",
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-8 items-center justify-center rounded-full bg-muted">
                    <Mail className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{inv.organizationName}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("Invited you to join as {role}", {
                        role: roleLabel(inv.role ?? "member"),
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isResponding}
                    onClick={() => onReject(inv.id)}
                  >
                    {t("Decline")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={isResponding}
                    onClick={() => setConfirmingInvitation(inv)}
                  >
                    {isResponding && <Spinner className="size-3.5" />}
                    {t("Accept")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
      <TeamAcceptInvitationDialog
        invitation={confirmingInvitation}
        onOpenChange={(open) => {
          if (!open) setConfirmingInvitation(null);
        }}
        onConfirm={onAccept}
      />
    </Card>
  );
}
