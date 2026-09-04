"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { supportEmail, supportMailto } from "@/lib/site";

function totpSecret(uri: string) {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

export function AccountScreen() {
  const { data: session, refetch } = authClient.useSession();
  const user = session?.user;
  const [name, setName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const email = supportEmail();
  const mail = supportMailto();
  const twoFactorEnabled = Boolean(user?.twoFactorEnabled);

  async function saveName() {
    const next = name.trim() || user?.name || "";
    if (!next) return;
    setBusy("name");
    setError("");
    setNotice("");
    const { error: nextError } = await authClient.updateUser({ name: next });
    if (nextError) setError(nextError.message || "Could not update name");
    else {
      setNotice("Name updated.");
      setName("");
      await refetch();
    }
    setBusy(null);
  }

  async function savePassword() {
    setBusy("password");
    setError("");
    setNotice("");
    const { error: nextError } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (nextError) setError(nextError.message || "Could not change password");
    else {
      setNotice("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
    }
    setBusy(null);
  }

  async function enableTwoFactor() {
    setBusy("2fa-enable");
    setError("");
    setNotice("");
    const { data, error: nextError } = await authClient.twoFactor.enable({
      password: twoFactorPassword,
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

  async function verifyTwoFactor() {
    setBusy("2fa-verify");
    setError("");
    setNotice("");
    const { error: nextError } = await authClient.twoFactor.verifyTotp({
      code: totpCode,
    });
    if (nextError) {
      setError(nextError.message || "Invalid authenticator code");
      setBusy(null);
      return;
    }
    setNotice("Two-factor authentication is on.");
    setTotpCode("");
    setTwoFactorPassword("");
    await refetch();
    setBusy(null);
  }

  async function disableTwoFactor() {
    setBusy("2fa-disable");
    setError("");
    setNotice("");
    const { error: nextError } = await authClient.twoFactor.disable({
      password: twoFactorPassword,
    });
    if (nextError) {
      setError(nextError.message || "Could not disable two-factor authentication");
      setBusy(null);
      return;
    }
    setNotice("Two-factor authentication is off.");
    setTotpUri("");
    setBackupCodes([]);
    setTwoFactorPassword("");
    await refetch();
    setBusy(null);
  }

  async function downloadExport() {
    setBusy("export");
    setError("");
    try {
      const res = await fetch("/api/account");
      if (!res.ok) throw new Error("Could not export data");
      const blob = new Blob([await res.text()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "deni-run-export.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export data");
    } finally {
      setBusy(null);
    }
  }

  async function destroy() {
    if (confirm !== "DELETE") return;
    setBusy("delete");
    setError("");
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) throw new Error("Could not delete account");
      await authClient.signOut();
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account");
      setBusy(null);
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-[#050505] px-6 py-12 text-[#f0f0f0]">
      <article className="mx-auto flex max-w-2xl flex-col gap-6">
        <Link href="/" className="text-xs text-[#8f8f8f] hover:text-[#f0f0f0]">
          Back to workspace
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">Account</h1>
          <p className="mt-2 text-sm text-[#8f8f8f]">
            {user?.email ?? "Signed in"} · manage profile, security, and stored data.
          </p>
        </div>

        <section className="rounded-xl border border-white/10 bg-[#111111] p-5">
          <h2 className="text-[0.925rem] font-semibold">Profile</h2>
          <div className="mt-4 flex flex-col gap-1.5">
            <Label htmlFor="display-name">Name</Label>
            <Input
              id="display-name"
              value={name}
              placeholder={user?.name || "Name"}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            loading={busy === "name"}
            onClick={() => void saveName()}
          >
            Save name
          </Button>
        </section>

        <section className="rounded-xl border border-white/10 bg-[#111111] p-5">
          <h2 className="text-[0.925rem] font-semibold">Password</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.currentTarget.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={newPassword}
                onChange={(event) => setNewPassword(event.currentTarget.value)}
              />
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            loading={busy === "password"}
            disabled={!currentPassword || newPassword.length < 8}
            onClick={() => void savePassword()}
          >
            Change password
          </Button>
        </section>

        <section className="rounded-xl border border-white/10 bg-[#111111] p-5">
          <h2 className="text-[0.925rem] font-semibold">Two-factor authentication</h2>
          <p className="mt-2 text-sm text-[#8f8f8f]">
            {twoFactorEnabled
              ? "An authenticator app is required after your password."
              : "Add an authenticator app so a stolen password is not enough to sign in."}
          </p>
          <div className="mt-4 flex flex-col gap-1.5">
            <Label htmlFor="2fa-password">Password</Label>
            <Input
              id="2fa-password"
              type="password"
              autoComplete="current-password"
              value={twoFactorPassword}
              onChange={(event) => setTwoFactorPassword(event.currentTarget.value)}
            />
          </div>
          {twoFactorEnabled ? (
            <Button
              type="button"
              variant="secondary"
              className="mt-4"
              loading={busy === "2fa-disable"}
              disabled={!twoFactorPassword}
              onClick={() => void disableTwoFactor()}
            >
              Disable two-factor
            </Button>
          ) : totpUri ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-[#c8c8c8]">
                Add this secret in your authenticator app, then enter a code to finish setup.
              </p>
              <code className="block break-all rounded-lg bg-black/40 px-3 py-2 text-xs">
                {totpSecret(totpUri) || totpUri}
              </code>
              {backupCodes.length ? (
                <div>
                  <p className="text-sm text-[#c8c8c8]">Save these backup codes. They are shown once.</p>
                  <pre className="mt-2 rounded-lg bg-black/40 px-3 py-2 text-xs leading-6">
                    {backupCodes.join("\n")}
                  </pre>
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="totp-code">Authenticator code</Label>
                <Input
                  id="totp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.currentTarget.value)}
                />
              </div>
              <Button
                type="button"
                loading={busy === "2fa-verify"}
                disabled={totpCode.length < 6}
                onClick={() => void verifyTwoFactor()}
              >
                Verify and enable
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="mt-4"
              loading={busy === "2fa-enable"}
              disabled={!twoFactorPassword}
              onClick={() => void enableTwoFactor()}
            >
              Enable authenticator app
            </Button>
          )}
        </section>

        <section className="rounded-xl border border-white/10 bg-[#111111] p-5">
          <h2 className="text-[0.925rem] font-semibold">Export</h2>
          <p className="mt-2 text-sm text-[#8f8f8f]">
            Download teammates, conversations, skills, routines, and usage. API keys are redacted.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            loading={busy === "export"}
            onClick={() => void downloadExport()}
          >
            Download JSON
          </Button>
        </section>
        <section className="rounded-xl border border-red-500/20 bg-[#111111] p-5">
          <h2 className="text-[0.925rem] font-semibold text-red-300">Delete account</h2>
          <p className="mt-2 text-sm text-[#8f8f8f]">
            This deletes your login, workspace files, conversations, teammates, and billing records.
            Type DELETE to confirm.
          </p>
          <Input
            className="mt-4"
            value={confirm}
            onChange={(event) => setConfirm(event.currentTarget.value)}
            placeholder="DELETE"
            aria-label="Type DELETE to confirm"
          />
          <Button
            type="button"
            variant="destructive"
            className="mt-4"
            disabled={confirm !== "DELETE"}
            loading={busy === "delete"}
            onClick={() => void destroy()}
          >
            Delete my account
          </Button>
        </section>
        {notice ? <p className="text-sm text-[#c8c8c8]">{notice}</p> : null}
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <p className="text-sm text-[#8f8f8f]">
          Support:{" "}
          {mail ? (
            <a href={mail} className="text-[#c8c8c8] hover:text-[#f0f0f0]">
              {email}
            </a>
          ) : (
            "set NEXT_PUBLIC_SUPPORT_EMAIL on this deployment."
          )}
        </p>
      </article>
    </main>
  );
}
