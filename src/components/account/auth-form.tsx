import { useExtracted } from "@/i18n/react";
import { Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Check, Copy, Download, Fingerprint, KeyRound, Loader2, Mail } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import QRCode from "react-qr-code";
import { FadeIn } from "@/components/common/motion";
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
import { authClient } from "@/lib/auth/client";
import { LanguageSwitcher } from "../common/language-switcher";
import { AppMark } from "../common/app-mark";

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

/** The Deni AI app icon, copied from the deni-ai repository (public/pwa/android-chrome-192x192.png). */
function DeniAiIcon() {
  return <img src="/brand/deni-ai.png" alt="" aria-hidden="true" draggable={false} className="size-4 shrink-0 rounded-[4px]" />;
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

function backupCodesFile(header: string[], codes: string[]) {
  return [
    ...header,
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
  const t = useExtracted();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const header = () => [
    t("Deni Run backup codes"),
    t("Saved {time}", { time: new Date().toISOString() }),
    "",
    t("Each code can be used once if you lose your authenticator app."),
  ];

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
    await navigator.clipboard.writeText(backupCodesFile(header(), codes));
    setCopied(true);
  }

  function download() {
    const blob = new Blob([backupCodesFile(header(), codes)], { type: "text/plain;charset=utf-8" });
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
    <div className="rounded-lg border border-foreground/10 bg-foreground/5 p-3">
      <p className="mb-2 text-xs text-muted-foreground">{t("Save these backup codes. They are shown once.")}</p>
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
              idleLabel={t("Copy")}
              doneLabel={t("Copied")}
            />
          </Button>
        </motion.div>
        <motion.div className="flex-1" animate={{ scale: saved ? 1.03 : 1 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}>
          <Button type="button" variant="secondary" size="sm" className="w-full" onClick={download}>
            <ActionFeedback
              done={saved}
              idleIcon={<Download />}
              doneIcon={<Check />}
              idleLabel={t("Download")}
              doneLabel={t("Saved")}
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
    <main className="relative flex min-h-full items-center justify-center bg-background p-6">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <FadeIn className="flex w-full max-w-sm flex-col gap-6">
        <Link to="/" className="mx-auto">
          <AppMark className="size-10" />
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
  const t = useExtracted();
  const router = useRouter();
  const passkeySupported = usePasskeySupport();
  const passkeyError = usePasskeyErrorMessage();
  const [busy, setBusy] = useState<"deni-ai" | "google" | "github" | "passkey" | null>(null);
  const [localError, setLocalError] = useState("");

  async function signIn(provider: "deni-ai" | "google" | "github") {
    setBusy(provider);
    setLocalError("");
    const { error: nextError } = await authClient.signIn.social({
      provider,
      callbackURL: "/",
      errorCallbackURL: "/sign-in?error=auth",
    });
    if (nextError) {
      setLocalError(nextError.message || t("Could not start sign-in"));
      setBusy(null);
    }
  }

  // A passkey account signs in with the passkey alone; it is unlocked with a fingerprint, face,
  // or PIN, so it already covers both factors.
  async function signInWithPasskey() {
    setBusy("passkey");
    setLocalError("");
    const { error: nextError } = await authClient.signIn.passkey();
    if (nextError) {
      setLocalError(passkeyError(nextError, t("Could not sign in with the passkey")));
      setBusy(null);
      return;
    }
    // Loaders cached while signed out are stale now.
    await router.invalidate();
    await router.navigate({ to: "/" });
  }

  const message =
    localError ||
    (error === "auth" ? t("Sign-in was cancelled or failed. Try again.") : error);

  return (
    <AuthCard
      title={title}
      description={t("Continue with your Deni AI account, Google, or GitHub, then confirm it is you once more.")}
      footer={
        <p className="text-center text-xs text-muted-foreground">
          {mode === "sign-in" ? (
            t.rich("New here? <link>Create an account</link>", {
              link: (chunks) => (
                <Link to="/sign-up" className="text-foreground hover:underline">
                  {chunks}
                </Link>
              ),
            })
          ) : (
            t.rich("Already have an account? <link>Sign in</link>", {
              link: (chunks) => (
                <Link to="/sign-in" className="text-foreground hover:underline">
                  {chunks}
                </Link>
              ),
            })
          )}
        </p>
      }
    >
      {/* Deni AI holds the plan and usage budget, so it is the primary way in. */}
      <Button
        type="button"
        variant="primary"
        size="md"
        className="w-full"
        loading={busy === "deni-ai"}
        disabled={busy !== null}
        onClick={() => void signIn("deni-ai")}
      >
        {busy === "deni-ai" ? null : <DeniAiIcon />}
        {t("Continue with Deni AI")}
      </Button>
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
        {t("Continue with Google")}
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
        {t("Continue with GitHub")}
      </Button>
      {mode === "sign-in" && passkeySupported ? (
        <Button
          type="button"
          variant="outline"
          size="md"
          className="w-full"
          loading={busy === "passkey"}
          disabled={busy !== null}
          onClick={() => void signInWithPasskey()}
        >
          {busy === "passkey" ? null : <Fingerprint />}
          {t("Sign in with passkey")}
        </Button>
      ) : null}
      {message ? <p className="text-center text-sm text-destructive-300">{message}</p> : null}
      <p className="text-center text-xs text-muted-foreground">
        {t.rich("By continuing you agree to the <terms>Terms</terms> and <privacy>Privacy</privacy> pages.", {
          terms: (chunks) => (
            <Link to="/terms" className="text-secondary-foreground hover:text-foreground">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link to="/privacy" className="text-secondary-foreground hover:text-foreground">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </AuthCard>
  );
}

export type TwoFactorMethod = "totp" | "email" | "passkey";

const RESEND_SECONDS = 30;

function useResendCooldown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);
  const start = useCallback(() => setSeconds(RESEND_SECONDS), []);
  return [seconds, start] as const;
}

const noSubscription = () => () => {};

// WebAuthn exists only in the browser, so this is false during server rendering.
function usePasskeySupport() {
  return useSyncExternalStore(
    noSubscription,
    () => typeof window.PublicKeyCredential === "function",
    () => false,
  );
}

type PasskeyError = { code?: string; message?: string } | null | undefined;

export function usePasskeyErrorMessage() {
  const t = useExtracted();
  return (error: PasskeyError, fallback: string) => {
    if (!error) return fallback;
    if (error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      return t("This device already has a passkey for Deni Run.");
    }
    if (
      error.code === "AUTH_CANCELLED" ||
      error.code === "ERROR_CEREMONY_ABORTED" ||
      error.code === "REGISTRATION_CANCELLED"
    ) {
      return t("The passkey prompt was closed. Try again.");
    }
    return error.message || fallback;
  };
}

function ResendButton({
  seconds,
  busy,
  onClick,
}: {
  seconds: number;
  busy: boolean;
  onClick: () => void;
}) {
  const t = useExtracted();
  return (
    <button
      type="button"
      className="text-center text-sm text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      disabled={seconds > 0 || busy}
      onClick={onClick}
    >
      {seconds > 0 ? t("Send a new code in {seconds}s", { seconds: String(seconds) }) : t("Send a new code")}
    </button>
  );
}

function PasskeyForm() {
  const t = useExtracted();
  const router = useRouter();
  const passkeyError = usePasskeyErrorMessage();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError("");
    const { error: nextError } = await authClient.signIn.passkey();
    if (nextError) {
      setError(passkeyError(nextError, t("Could not confirm with the passkey")));
      setBusy(false);
      return;
    }
    // Loaders cached while signed out are stale now.
    await router.invalidate();
    await router.navigate({ to: "/" });
  }

  return (
    <AuthCard
      title={t("Two-factor authentication")}
      description={t("Confirm it is you with your fingerprint, face, or screen lock.")}
    >
      <Button type="button" size="md" className="w-full" loading={busy} onClick={() => void signIn()}>
        {busy ? null : <Fingerprint />}
        {t("Continue with passkey")}
      </Button>
      {error ? <p className="text-center text-sm text-destructive-300">{error}</p> : null}
    </AuthCard>
  );
}

export function TwoFactorForm({ method }: { method: TwoFactorMethod }) {
  if (method === "passkey") return <PasskeyForm />;
  return <CodeForm method={method} />;
}

function CodeForm({ method }: { method: "totp" | "email" }) {
  const t = useExtracted();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(true);
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, startCooldown] = useResendCooldown();
  const sentOnce = useRef(false);
  const byEmail = method === "email";

  const sendCode = useCallback(async () => {
    setSending(true);
    setError("");
    const { error: nextError } = await authClient.twoFactor.sendOtp();
    if (nextError) setError(nextError.message || t("Could not send a code"));
    else startCooldown();
    setSending(false);
  }, [startCooldown, t]);

  // Send once when the page opens; later codes come from the resend button.
  useEffect(() => {
    if (!byEmail || sentOnce.current) return;
    sentOnce.current = true;
    void sendCode();
  }, [byEmail, sendCode]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : byEmail
        ? await authClient.twoFactor.verifyOtp({ code, trustDevice })
        : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    if (result.error) {
      setError(result.error.message || t("Invalid code"));
      setBusy(false);
      return;
    }
    // Loaders cached while signed out are stale now.
    await router.invalidate();
    await router.navigate({ to: "/" });
  }

  const description = useBackup
    ? t("Enter a backup code from when you enabled two-factor authentication.")
    : byEmail
      ? t("We emailed you a 6-digit code. Check your inbox and spam folder.")
      : t("Enter the 6-digit code from your authenticator app.");

  return (
    <AuthCard title={t("Two-factor authentication")} description={description}>
      <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">{useBackup ? t("Backup code") : t("One-time code")}</Label>
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
        <label className="flex items-center gap-2 text-sm text-secondary-foreground">
          <Checkbox
            checked={trustDevice}
            onCheckedChange={(value) => setTrustDevice(value === true)}
          />
          {t("Trust this device for 30 days")}
        </label>
        {error ? <p className="text-sm text-destructive-300">{error}</p> : null}
        <Button type="submit" size="md" className="w-full" loading={busy} disabled={!useBackup && code.length < 6}>
          {t("Verify")}
        </Button>
      </form>
      {byEmail ? (
        <ResendButton seconds={cooldown} busy={sending} onClick={() => void sendCode()} />
      ) : (
        // Backup codes belong to the authenticator setup; email accounts have none.
        <button
          type="button"
          className="text-center text-sm text-muted-foreground hover:text-foreground"
          onClick={() => {
            setUseBackup((current) => !current);
            setCode("");
            setError("");
          }}
        >
          {useBackup ? t("Use authenticator app") : t("Use a backup code")}
        </button>
      )}
    </AuthCard>
  );
}

function SignOutLink() {
  const t = useExtracted();
  return (
    <button
      type="button"
      className="text-center text-sm text-muted-foreground hover:text-foreground"
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
      {t("Sign out")}
    </button>
  );
}

function MethodOption({
  icon,
  title,
  description,
  onClick,
  loading,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-start gap-3 rounded-xl border border-foreground/10 p-3 text-left transition-colors hover:bg-foreground/5 disabled:pointer-events-none disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading}
    >
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">
        {loading ? <Loader2 className="animate-spin" /> : icon}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

export function TwoFactorSetupForm({
  email,
  emailAvailable,
}: {
  email: string;
  emailAvailable: boolean;
}) {
  const t = useExtracted();
  const router = useRouter();
  const passkeySupported = usePasskeySupport();
  const passkeyError = usePasskeyErrorMessage();
  const [step, setStep] = useState<"choose" | "code" | "totp">("choose");
  const [totpUri, setTotpUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"enable" | "email" | "passkey" | "verify" | "resend" | null>(null);
  const [cooldown, startCooldown] = useResendCooldown();
  const offersEasierMethods = emailAvailable || passkeySupported;

  async function enable() {
    setBusy("enable");
    setError("");
    const { data, error: nextError } = await authClient.twoFactor.enable({
      method: "totp",
    });
    if (nextError) {
      setError(nextError.message || t("Could not start two-factor setup"));
      setBusy(null);
      return;
    }
    if (data && "totpURI" in data && data.totpURI) {
      setTotpUri(data.totpURI);
      setBackupCodes(data.backupCodes ?? []);
      setCode("");
      setStep("totp");
    }
    setBusy(null);
  }

  async function addPasskey() {
    setBusy("passkey");
    setError("");
    const { error: nextError } = await authClient.passkey.addPasskey();
    if (nextError) {
      setError(passkeyError(nextError, t("Could not add the passkey")));
      setBusy(null);
      return;
    }
    // Loaders cached while signed out are stale now.
    await router.invalidate();
    await router.navigate({ to: "/" });
  }

  async function startEmail() {
    setBusy("email");
    setError("");
    const res = await fetch("/api/two-factor/method", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "email" }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error || t("Could not start two-factor setup"));
      setBusy(null);
      return;
    }
    const { error: nextError } = await authClient.twoFactor.sendOtp();
    if (nextError) {
      setError(nextError.message || t("Could not send a code"));
      setBusy(null);
      return;
    }
    setCode("");
    setStep("code");
    startCooldown();
    setBusy(null);
  }

  async function resend() {
    setBusy("resend");
    setError("");
    const { error: nextError } = await authClient.twoFactor.sendOtp();
    if (nextError) setError(nextError.message || t("Could not send a code"));
    else startCooldown();
    setBusy(null);
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy("verify");
    setError("");
    const { error: nextError } =
      step === "code"
        ? await authClient.twoFactor.verifyOtp({ code })
        : await authClient.twoFactor.verifyTotp({ code });
    if (nextError) {
      setError(nextError.message || t("Invalid code"));
      setBusy(null);
      return;
    }
    // Loaders cached while signed out are stale now.
    await router.invalidate();
    await router.navigate({ to: "/" });
  }

  const backLink = (
    <button
      type="button"
      className="text-center text-sm text-muted-foreground hover:text-foreground"
      onClick={() => {
        setStep("choose");
        setCode("");
        setError("");
      }}
    >
      {t("Choose another method")}
    </button>
  );

  const codeForm = (
    <form className="flex flex-col gap-3" onSubmit={(event) => void verify(event)}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="setup-code">{t("One-time code")}</Label>
        <OneTimeCode id="setup-code" value={code} onChange={setCode} />
      </div>
      {error ? <p className="text-sm text-destructive-300">{error}</p> : null}
      <Button type="submit" size="md" className="w-full" loading={busy === "verify"} disabled={code.length < 6}>
        {t("Verify and continue")}
      </Button>
    </form>
  );

  if (step === "code") {
    return (
      <AuthCard
        title={t("Enter your code")}
        description={t("We sent a 6-digit code to {email}. Check your spam folder if it does not arrive.", { email })}
      >
        {codeForm}
        <ResendButton seconds={cooldown} busy={busy === "resend"} onClick={() => void resend()} />
        {backLink}
      </AuthCard>
    );
  }

  if (step === "totp") {
    const secret = totpSecret(totpUri);
    return (
      <AuthCard
        title={t("Scan the QR code")}
        description={t("Add Deni Run in your authenticator app, save the backup codes, then enter a 6-digit code.")}
      >
        <div className="mx-auto rounded-xl bg-white p-3">
          <QRCode value={totpUri} size={168} />
        </div>
        {secret ? (
          <p className="break-all text-center font-mono text-xs text-muted-foreground">{secret}</p>
        ) : null}
        <BackupCodesPanel codes={backupCodes} />
        {codeForm}
        {offersEasierMethods ? backLink : null}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("Set up two-factor authentication")}
      description={
        offersEasierMethods
          ? t("After you sign in, you confirm it is you once more. Choose how.")
          : t("An authenticator app is required after you sign in.")
      }
      footer={<SignOutLink />}
    >
      {passkeySupported ? (
        <MethodOption
          icon={<Fingerprint />}
          title={t("Passkey")}
          description={t("Use your fingerprint, face, or screen lock. Nothing to type.")}
          loading={busy === "passkey"}
          disabled={busy !== null}
          onClick={() => void addPasskey()}
        />
      ) : null}
      {emailAvailable ? (
        <MethodOption
          icon={<Mail />}
          title={t("Email")}
          description={t("Get a 6-digit code at {email} each time.", { email })}
          loading={busy === "email"}
          disabled={busy !== null}
          onClick={() => void startEmail()}
        />
      ) : null}
      {offersEasierMethods ? (
        <MethodOption
          icon={<KeyRound />}
          title={t("Authenticator app")}
          description={t("Use an app such as Google Authenticator or 1Password.")}
          loading={busy === "enable"}
          disabled={busy !== null}
          onClick={() => void enable()}
        />
      ) : (
        <Button type="button" size="md" className="w-full" loading={busy === "enable"} onClick={() => void enable()}>
          {t("Enable authenticator app")}
        </Button>
      )}
      {error ? <p className="text-sm text-destructive-300">{error}</p> : null}
    </AuthCard>
  );
}
