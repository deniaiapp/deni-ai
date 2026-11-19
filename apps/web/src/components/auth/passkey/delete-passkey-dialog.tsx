import type { PasskeyAuthClient } from "@better-auth-ui/core/plugins/passkey";
import { useAuth, useAuthPlugin } from "@better-auth-ui/react";
import { useDeletePasskey } from "@better-auth-ui/react/plugins/passkey";
import { Fingerprint } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@deniai/ui/components/alert-dialog";
import { Button } from "@deniai/ui/components/button";
import { Field } from "@deniai/ui/components/field";
import { Input } from "@deniai/ui/components/input";
import { Label } from "@deniai/ui/components/label";
import { Spinner } from "@deniai/ui/components/spinner";
import { passkeyPlugin } from "@/lib/auth/passkey-plugin";

export type ListedPasskey = {
  id: string;
  name?: string | null;
  createdAt: Date;
};

export type DeletePasskeyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  passkey: ListedPasskey;
};

export function DeletePasskeyDialog({ open, onOpenChange, passkey }: DeletePasskeyDialogProps) {
  const { authClient, localization } = useAuth();
  const { localization: passkeyLocalization } = useAuthPlugin(passkeyPlugin);

  const passkeyName = passkey.name || passkeyLocalization.passkey;
  const previewId = `delete-passkey-preview-${passkey.id}`;

  const { mutate: deletePasskey, isPending: isDeleting } = useDeletePasskey(
    authClient as PasskeyAuthClient,
    {
      onSuccess: () => onOpenChange(false),
    },
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Fingerprint />
          </AlertDialogMedia>

          <AlertDialogTitle>{passkeyLocalization.deletePasskeyTitle}</AlertDialogTitle>

          <AlertDialogDescription>
            {passkeyLocalization.deletePasskeyWarning}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Field>
          <Label htmlFor={previewId}>{passkey.name || passkeyLocalization.passkey}</Label>

          <Input id={previewId} value={passkeyName} readOnly disabled />
        </Field>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {localization.settings.cancel}
          </AlertDialogCancel>

          <Button
            type="button"
            variant="destructive"
            disabled={isDeleting}
            onClick={() => deletePasskey({ id: passkey.id })}
          >
            {isDeleting && <Spinner />}

            {passkeyLocalization.deletePasskeyTitle}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
