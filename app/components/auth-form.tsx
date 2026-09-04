"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

function authErrorMessage(error: { message?: string; status?: number } | null) {
  if (!error) return "Something went wrong";
  if (error.status === 429) return "Too many attempts. Wait a moment and try again.";
  return error.message || "Something went wrong";
}

function AuthShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-full items-center justify-center bg-[#050505] p-6">
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#111111] p-6">
        <Link href="/" className="text-xs text-[#8f8f8f] hover:text-[#f0f0f0]">
          Deni Run
        </Link>
        <h1 className="mt-4 text-xl font-semibold text-[#f0f0f0]">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const { data, error: nextError } = await authClient.signIn.email({
      email,
      password,
    });
    if (nextError) {
      setError(authErrorMessage(nextError));
      setBusy(false);
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      router.push("/two-factor");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <AuthShell title="Sign in">
      <form className="mt-5 flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </div>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <Button type="submit" size="md" loading={busy}>
          Sign in
        </Button>
      </form>
      <p className="mt-4 text-sm text-[#8f8f8f]">
        No account?{" "}
        <Link href="/sign-up" className="text-[#f0f0f0] hover:underline">
          Get started
        </Link>
      </p>
    </AuthShell>
  );
}

export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    setError("");
    const { error: nextError } = await authClient.signUp.email({
      name,
      email,
      password,
    });
    if (nextError) {
      setError(authErrorMessage(nextError));
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <AuthShell title="Create account">
      <form className="mt-5 flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            autoComplete="name"
            required
            minLength={2}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(event) => setConfirm(event.currentTarget.value)}
          />
        </div>
        <p className="text-xs text-[#8f8f8f]">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="text-[#c8c8c8] hover:text-[#f0f0f0]">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-[#c8c8c8] hover:text-[#f0f0f0]">
            Privacy
          </Link>{" "}
          pages.
        </p>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <Button type="submit" size="md" loading={busy}>
          Create account
        </Button>
      </form>
      <p className="mt-4 text-sm text-[#8f8f8f]">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-[#f0f0f0] hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
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
      ? await authClient.twoFactor.verifyBackupCode({
          code,
          trustDevice,
        })
      : await authClient.twoFactor.verifyTotp({
          code,
          trustDevice,
        });
    if (result.error) {
      setError(authErrorMessage(result.error));
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <AuthShell title="Two-factor authentication">
      <p className="mt-2 text-sm text-[#8f8f8f]">
        {useBackup
          ? "Enter a backup code from when you enabled two-factor authentication."
          : "Enter the 6-digit code from your authenticator app."}
      </p>
      <form className="mt-5 flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">{useBackup ? "Backup code" : "Authenticator code"}</Label>
          <Input
            id="code"
            inputMode={useBackup ? "text" : "numeric"}
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(event) => setCode(event.currentTarget.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-[#c8c8c8]">
          <Checkbox
            checked={trustDevice}
            onCheckedChange={(value) => setTrustDevice(value === true)}
          />
          Trust this device for 30 days
        </label>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <Button type="submit" size="md" loading={busy}>
          Continue
        </Button>
      </form>
      <button
        type="button"
        className="mt-4 text-sm text-[#8f8f8f] hover:text-[#f0f0f0]"
        onClick={() => {
          setUseBackup((current) => !current);
          setCode("");
          setError("");
        }}
      >
        {useBackup ? "Use authenticator code" : "Use a backup code"}
      </button>
    </AuthShell>
  );
}
