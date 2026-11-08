import { useAuth, useListAccounts } from "@better-auth-ui/react";
import { createQrCodeSvgData, downloadTextFile } from "@better-auth-ui/core";
import { ShieldCheck } from "lucide-react";
import { type SyntheticEvent, useState } from "react";
import { toast } from "sonner";
import { useExtracted } from "use-intl";

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
import { Badge } from "@deniai/ui/components/badge";
import { Button } from "@deniai/ui/components/button";
import { Card, CardContent } from "@deniai/ui/components/card";
import { Field, FieldError } from "@deniai/ui/components/field";
import { Input } from "@deniai/ui/components/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@deniai/ui/components/input-otp";
import { Label } from "@deniai/ui/components/label";
import { Skeleton } from "@deniai/ui/components/skeleton";
import { Spinner } from "@deniai/ui/components/spinner";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { authClient } from "@/lib/auth-client";
import { runWithLoading } from "@/lib/run-with-loading";
import { resetAuthStateCache } from "@/lib/session-functions";
import { cn } from "@/lib/utils";

const CODE_LENGTH = 6;

/** What the password dialog is confirming. */
type PasswordAction = "enable" | "disable" | "regenerate";

type DialogStep =
  | { kind: "password"; action: PasswordAction }
  | { kind: "scan"; totpURI: string; backupCodes: string[] }
  | { kind: "backup-codes"; backupCodes: string[] };

export type TwoFactorSettingsProps = {
  className?: string;
};

/**
 * Turns two-factor authentication on or off and regenerates backup codes.
 *
 * Better Auth asks for the password for every change, and the second factor is
 * only checked on password and email-link sign-ins (src/lib/auth.ts), so
 * accounts without a password are asked to set one first.
 */
export function TwoFactorSettings({ className }: TwoFactorSettingsProps) {
  const t = useExtracted();
  const { authClient: uiAuthClient } = useAuth();
  // Better Auth's own hook: its session type includes the two-factor plugin's fields.
  const { data: session, refetch: refetchSession } = authClient.useSession();
  const { data: accounts, isPending: isAccountsPending } = useListAccounts(uiAuthClient);
  const [step, setStep] = useState<DialogStep | null>(null);

  const enabled = Boolean(session?.user.twoFactorEnabled);
  const hasPassword = accounts?.some((account) => account.providerId === "credential");

  const closeDialog = () => setStep(null);
  const finishEnrollment = (backupCodes: string[]) => {
    // The app guard caches the two-factor rule; recheck it on the next navigation.
    resetAuthStateCache();
    void refetchSession();
    setStep({ kind: "backup-codes", backupCodes });
  };

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">{t("Two-factor authentication")}</h2>

      <Card className={cn(className)}>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {isAccountsPending || !session ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <>
              <div>
                <p className="flex items-center gap-2 text-sm leading-tight font-medium">
                  {t("Authenticator app")}
                  <Badge variant={enabled ? "default" : "secondary"}>
                    {enabled ? t("On") : t("Off")}
                  </Badge>
                </p>

                <p className="text-muted-foreground mt-0.5 text-xs">
                  {hasPassword
                    ? t(
                        "Ask for a code from an authenticator app when you sign in with your password or an email link.",
                      )
                    : t(
                        "Set a password first. Two-factor authentication protects password sign-ins.",
                      )}
                </p>
              </div>

              {enabled ? (
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setStep({ kind: "password", action: "regenerate" })}
                  >
                    {t("New backup codes")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setStep({ kind: "password", action: "disable" })}
                  >
                    {t("Turn off")}
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={!hasPassword}
                  onClick={() => setStep({ kind: "password", action: "enable" })}
                >
                  {t("Turn on")}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={step !== null} onOpenChange={(open) => !open && closeDialog()}>
        <AlertDialogContent>
          {step?.kind === "password" && (
            <PasswordStep
              action={step.action}
              onCancel={closeDialog}
              onEnabled={(totpURI, backupCodes) => setStep({ kind: "scan", totpURI, backupCodes })}
              onDisabled={() => {
                resetAuthStateCache();
                void refetchSession();
                toast.success(t("Two-factor authentication is off"));
                closeDialog();
              }}
              onRegenerated={(backupCodes) => setStep({ kind: "backup-codes", backupCodes })}
            />
          )}
          {step?.kind === "scan" && (
            <ScanStep
              totpURI={step.totpURI}
              onCancel={closeDialog}
              onVerified={() => finishEnrollment(step.backupCodes)}
            />
          )}
          {step?.kind === "backup-codes" && (
            <BackupCodesStep backupCodes={step.backupCodes} onDone={closeDialog} />
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PasswordStep({
  action,
  onCancel,
  onEnabled,
  onDisabled,
  onRegenerated,
}: {
  action: PasswordAction;
  onCancel: () => void;
  onEnabled: (totpURI: string, backupCodes: string[]) => void;
  onDisabled: () => void;
  onRegenerated: (backupCodes: string[]) => void;
}) {
  const t = useExtracted();
  const localizeError = useLocalizeError();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isPending, setIsPending] = useState(false);

  const copy = {
    enable: {
      title: t("Turn on two-factor authentication"),
      submit: t("Continue"),
    },
    disable: {
      title: t("Turn off two-factor authentication"),
      submit: t("Turn off"),
    },
    regenerate: {
      title: t("Create new backup codes"),
      submit: t("Create codes"),
    },
  }[action];

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!password || isPending) return;

    void runWithLoading(setIsPending, async () => {
      setError(undefined);

      if (action === "enable") {
        const { data, error: enableError } = await authClient.twoFactor.enable({ password });
        if (enableError || !data || !("totpURI" in data)) {
          setError(localizeError(enableError, t("Couldn't turn on two-factor authentication")));
          return;
        }
        onEnabled(data.totpURI, data.backupCodes);
        return;
      }

      if (action === "disable") {
        const { error: disableError } = await authClient.twoFactor.disable({ password });
        if (disableError) {
          setError(localizeError(disableError));
          return;
        }
        onDisabled();
        return;
      }

      const { data, error: regenerateError } = await authClient.twoFactor.generateBackupCodes({
        password,
      });
      if (regenerateError || !data) {
        setError(localizeError(regenerateError));
        return;
      }
      onRegenerated(data.backupCodes);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <AlertDialogHeader>
        <AlertDialogMedia>
          <ShieldCheck />
        </AlertDialogMedia>
        <AlertDialogTitle>{copy.title}</AlertDialogTitle>
        <AlertDialogDescription>
          {action === "regenerate"
            ? t("Your old backup codes stop working. Enter your password to continue.")
            : t("Enter your password to continue.")}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <Field data-invalid={!!error}>
        <Label htmlFor="two-factor-password">{t("Password")}</Label>
        <Input
          id="two-factor-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(undefined);
          }}
          disabled={isPending}
          aria-invalid={!!error}
        />
        <FieldError>{error}</FieldError>
      </Field>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending} onClick={onCancel}>
          {t("Cancel")}
        </AlertDialogCancel>
        <Button
          type="submit"
          variant={action === "disable" ? "destructive" : "default"}
          disabled={!password || isPending}
        >
          {isPending && <Spinner />}
          {copy.submit}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}

function ScanStep({
  totpURI,
  onCancel,
  onVerified,
}: {
  totpURI: string;
  onCancel: () => void;
  onVerified: () => void;
}) {
  const t = useExtracted();
  const localizeError = useLocalizeError();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isPending, setIsPending] = useState(false);

  const qrCode = createQrCodeSvgData(totpURI);
  const setupKey = new URL(totpURI).searchParams.get("secret") ?? "";

  const verify = (value: string) => {
    if (value.length !== CODE_LENGTH || isPending) return;

    void runWithLoading(setIsPending, async () => {
      setError(undefined);
      const { error: verifyError } = await authClient.twoFactor.verifyTotp({ code: value });
      if (verifyError) {
        setError(localizeError(verifyError, t("Invalid verification code")));
        setCode("");
        return;
      }
      toast.success(t("Two-factor authentication is on"));
      onVerified();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <AlertDialogHeader>
        <AlertDialogTitle>{t("Scan the QR code")}</AlertDialogTitle>
        <AlertDialogDescription>
          {t(
            "Scan this code with an authenticator app such as Google Authenticator or 1Password, then enter the 6-digit code it shows.",
          )}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div className="flex flex-col items-center gap-3">
        <svg
          viewBox={`0 0 ${qrCode.size} ${qrCode.size}`}
          className="size-44 rounded-md bg-white"
          role="img"
          aria-label={t("QR code for your authenticator app")}
          shapeRendering="crispEdges"
        >
          <path d={qrCode.path} fill="#000" />
        </svg>

        <div className="text-center">
          <p className="text-muted-foreground text-xs">
            {t("Can't scan it? Enter this key instead:")}
          </p>
          <code className="text-xs break-all select-all">{setupKey}</code>
        </div>
      </div>

      <Field data-invalid={!!error}>
        <Label htmlFor="two-factor-setup-code">{t("Authentication code")}</Label>
        <div className="flex justify-center">
          <InputOTP
            id="two-factor-setup-code"
            maxLength={CODE_LENGTH}
            value={code}
            onChange={(value) => {
              setCode(value);
              setError(undefined);
              verify(value);
            }}
            disabled={isPending}
            containerClassName="gap-2"
            aria-invalid={!!error}
          >
            <InputOTPGroup>
              {Array.from({ length: CODE_LENGTH }, (_, index) => (
                <InputOTPSlot key={index} index={index} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        <FieldError>{error}</FieldError>
      </Field>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending} onClick={onCancel}>
          {t("Cancel")}
        </AlertDialogCancel>
        <Button disabled={code.length !== CODE_LENGTH || isPending} onClick={() => verify(code)}>
          {isPending && <Spinner />}
          {t("Verify")}
        </Button>
      </AlertDialogFooter>
    </div>
  );
}

function BackupCodesStep({ backupCodes, onDone }: { backupCodes: string[]; onDone: () => void }) {
  const t = useExtracted();
  const text = backupCodes.join("\n");

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("Copied!"));
    } catch {
      toast.error(t("Couldn't copy. Select the codes and copy them instead."));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <AlertDialogHeader>
        <AlertDialogTitle>{t("Save your backup codes")}</AlertDialogTitle>
        <AlertDialogDescription>
          {t(
            "If you lose your authenticator app, sign in with one of these codes. Each code works once. They won't be shown again.",
          )}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <ul className="bg-muted grid grid-cols-2 gap-x-6 gap-y-1 rounded-md p-4 font-mono text-sm select-all">
        {backupCodes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>

      <AlertDialogFooter>
        <Button variant="outline" onClick={() => void copyCodes()}>
          {t("Copy")}
        </Button>
        <Button
          variant="outline"
          onClick={() => downloadTextFile(text, "deni-ai-backup-codes.txt")}
        >
          {t("Download")}
        </Button>
        <Button onClick={onDone}>{t("Done")}</Button>
      </AlertDialogFooter>
    </div>
  );
}
