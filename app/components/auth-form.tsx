"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Check, Copy, Download } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import QRCode from "react-qr-code";
import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true">
      <path d="M12 2C6.5 2 2 6.6 2 12.2c0 4.5 2.9 8.3 6.9 9.6.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.4-3.4-1.4-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1 .8-.2 1.6-.3 2.4-.3s1.6.1 2.4.3c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7 1 .7 2v2.9c0 .3.2.6.7.5 4-1.3 6.9-5.1 6.9-9.6C22 6.6 17.5 2 12 2z" />
    </svg>
  );
}

function OneTimeCode({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <InputOTP
      id={id}
      maxLength={6}
      pattern={REGEXP_ONLY_DIGITS}
      value={value}
      onChange={onChange}
      autoComplete="one-time-code"
    >
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  );
}

function backupCodesFile(codes: string[]) {
  return [
    "Deni Run backup codes",
    `Saved ${new Date().toISOString()}`,
    "",
    "Each code can be used once if you lose your authenticator app.",
    "",
    ...codes,
    "",
  ].join("\n");
}

function ActionFeedback({
  done,
  idleIcon,
  doneIcon,
  idleLabel,
  doneLabel,
}: {
  done: boolean;
  idleIcon: ReactNode;
  doneIcon: ReactNode;
  idleLabel: string;
  doneLabel: string;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={done ? doneLabel : idleLabel}
        initial={{ y: 8, opacity: 0, filter: "blur(4px)" }}
        animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
        exit={{ y: -8, opacity: 0, filter: "blur(4px)" }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="inline-flex items-center gap-2"
      >
        <motion.span
          key={done ? "done-icon" : "idle-icon"}
          initial={{ scale: 0.6, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 520, damping: 22 }}
          className="inline-flex"
        >
          {done ? doneIcon : idleIcon}
        </motion.span>
        {done ? doneLabel : idleLabel}
      </motion.span>
    </AnimatePresence>
  );
}

export function BackupCodesPanel({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 1600);
    return () => window.clearTimeout(timer);
  }, [saved]);

  async function copy() {
    await navigator.clipboard.writeText(backupCodesFile(codes));
    setCopied(true);
  }

  function download() {
    const blob = new Blob([backupCodesFile(codes)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "deni-run-backup-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  }

  if (!codes.length) return null;

  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
      <p className="mb-2 text-xs text-[#8f8f8f]">Save these backup codes. They are shown once.</p>
      <div className="grid grid-cols-2 gap-1 font-mono text-xs">
        {codes.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <motion.div className="flex-1" animate={{ scale: copied ? 1.03 : 1 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}>
          <Button type="button" variant="secondary" size="sm" className="w-full" onClick={() => void copy()}>
            <ActionFeedback
              done={copied}
              idleIcon={<Copy />}
              doneIcon={<Check />}
              idleLabel="Copy"
              doneLabel="Copied"
            />
          </Button>
        </motion.div>
        <motion.div className="flex-1" animate={{ scale: saved ? 1.03 : 1 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}>
          <Button type="button" variant="secondary" size="sm" className="w-full" onClick={download}>
            <ActionFeedback
              done={saved}
              idleIcon={<Download />}
              doneIcon={<Check />}
              idleLabel="Download"
              doneLabel="Saved"
            />
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

function totpSecret(uri: string) {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-full items-center justify-center bg-[#050505] p-6">
      <FadeIn className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" className="text-center text-sm font-medium text-[#f0f0f0]">
          Deni Run
        </Link>
        <Card className="gap-6 p-6">
          <CardHeader className="items-center text-center">
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">{children}</CardContent>
          {footer ? <CardFooter className="justify-center">{footer}</CardFooter> : null}
        </Card>
      </FadeIn>
    </main>
  );
}

export function SocialAuth({
  title,
  error,
  mode,
}: {
  title: string;
  error?: string;
  mode: "sign-in" | "sign-up";
}) {
  const [busy, setBusy] = useState<"google" | "github" | null>(null);
  const [localError, setLocalError] = useState("");

  async function signIn(provider: "google" | "github") {
    setBusy(provider);
    setLocalError("");
    const { error: nextError } = await authClient.signIn.social({
      provider,
      callbackURL: "/",
      errorCallbackURL: "/sign-in?error=auth",
    });
    if (nextError) {
      setLocalError(nextError.message || "Could not start sign-in");
      setBusy(null);
    }
  }

  const message =
    localError ||
    (error === "auth" ? "Sign-in was cancelled or failed. Try again." : error);

  return (
    <AuthCard
      title={title}
      description="Continue with Google or GitHub, then set up an authenticator app."
      footer={
        <p className="text-center text-xs text-[#8f8f8f]">
          {mode === "sign-in" ? (
            <>
              New here?{" "}
              <Link href="/sign-up" className="text-[#f0f0f0] hover:underline">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/sign-in" className="text-[#f0f0f0] hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      }
    >
      <Button
        type="button"
        variant="outline"
        size="md"
        className="w-full"
        loading={busy === "google"}
        disabled={busy !== null}
        onClick={() => void signIn("google")}
      >
        {busy === "google" ? null : <GoogleIcon />}
        Continue with Google
      </Button>
      <Button
        type="button"
        variant="outline"
        size="md"
        className="w-full"
        loading={busy === "github"}
        disabled={busy !== null}
        onClick={() => void signIn("github")}
      >
        {busy === "github" ? null : <GitHubIcon />}
        Continue with GitHub
      </Button>
      {message ? <p className="text-center text-sm text-red-300">{message}</p> : null}
      <p className="text-center text-xs text-[#8f8f8f]">
        By continuing you agree to the{" "}
        <Link href="/terms" className="text-[#c8c8c8] hover:text-[#f0f0f0]">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="text-[#c8c8c8] hover:text-[#f0f0f0]">
          Privacy
        </Link>{" "}
        pages.
      </p>
    </AuthCard>
  );
}

export function TwoFactorForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(true);
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    if (result.error) {
      setError(result.error.message || "Invalid code");
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <AuthCard
      title="Two-factor authentication"
      description={
        useBackup
          ? "Enter a backup code from when you enabled two-factor authentication."
          : "Enter the 6-digit code from your authenticator app."
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">{useBackup ? "Backup code" : "One-time code"}</Label>
          {useBackup ? (
            <Input
              id="code"
              autoComplete="one-time-code"
              required
              maxLength={16}
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
            />
          ) : (
            <OneTimeCode id="code" value={code} onChange={setCode} />
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-[#c8c8c8]">
          <Checkbox
            checked={trustDevice}
            onCheckedChange={(value) => setTrustDevice(value === true)}
          />
          Trust this device for 30 days
        </label>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <Button type="submit" size="md" className="w-full" loading={busy} disabled={!useBackup && code.length < 6}>
          Verify
        </Button>
      </form>
      <button
        type="button"
        className="text-center text-sm text-[#8f8f8f] hover:text-[#f0f0f0]"
        onClick={() => {
          setUseBackup((current) => !current);
          setCode("");
          setError("");
        }}
      >
        {useBackup ? "Use authenticator app" : "Use a backup code"}
      </button>
    </AuthCard>
  );
}

export function TwoFactorSetupForm() {
  const router = useRouter();
  const [totpUri, setTotpUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"enable" | "verify" | null>(null);

  async function enable() {
    setBusy("enable");
    setError("");
    const { data, error: nextError } = await authClient.twoFactor.enable({
      method: "totp",
    });
    if (nextError) {
      setError(nextError.message || "Could not start two-factor setup");
      setBusy(null);
      return;
    }
    if (data && "totpURI" in data) {
      setTotpUri(data.totpURI);
      setBackupCodes(data.backupCodes ?? []);
    }
    setBusy(null);
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy("verify");
    setError("");
    const { error: nextError } = await authClient.twoFactor.verifyTotp({ code });
    if (nextError) {
      setError(nextError.message || "Invalid authenticator code");
      setBusy(null);
      return;
    }
    router.push("/");
    router.refresh();
  }

  if (!totpUri) {
    return (
      <AuthCard
        title="Set up two-factor authentication"
        description="An authenticator app is required after Google or GitHub sign-in."
      >
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <Button type="button" size="md" className="w-full" loading={busy === "enable"} onClick={() => void enable()}>
          Enable authenticator app
        </Button>
        <button
          type="button"
          className="text-center text-sm text-[#8f8f8f] hover:text-[#f0f0f0]"
          onClick={() =>
            void authClient.signOut({
              fetchOptions: {
                onSuccess: () => {
                  window.location.href = "/";
                },
              },
            })
          }
        >
          Sign out
        </button>
      </AuthCard>
    );
  }

  const secret = totpSecret(totpUri);

  return (
    <AuthCard
      title="Scan the QR code"
      description="Add Deni Run in your authenticator app, save the backup codes, then enter a 6-digit code."
    >
      <div className="mx-auto rounded-xl bg-white p-3">
        <QRCode value={totpUri} size={168} />
      </div>
      {secret ? (
        <p className="break-all text-center font-mono text-xs text-[#8f8f8f]">{secret}</p>
      ) : null}
      <BackupCodesPanel codes={backupCodes} />
      <form className="flex flex-col gap-3" onSubmit={(event) => void verify(event)}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-code">One-time code</Label>
          <OneTimeCode id="setup-code" value={code} onChange={setCode} />
        </div>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <Button type="submit" size="md" className="w-full" loading={busy === "verify"} disabled={code.length < 6}>
          Verify and continue
        </Button>
      </form>
    </AuthCard>
  );
}
