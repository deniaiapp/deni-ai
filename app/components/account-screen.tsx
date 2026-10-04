"use client";

import { useExtracted } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { Stagger, StaggerItem } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackupCodesPanel } from "./auth-form";
import { authClient } from "@/lib/auth-client";
import { supportEmail, supportMailto } from "@/lib/site";

export function AccountScreen() {
  const t = useExtracted();
  const { data: session, refetch } = authClient.useSession();
  const user = session?.user;
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const email = supportEmail();
  const mail = supportMailto();

  async function saveName() {
    const next = name.trim() || user?.name || "";
    if (!next) return;
    setBusy("name");
    setError("");
    setNotice("");
    const { error: nextError } = await authClient.updateUser({ name: next });
    if (nextError) setError(nextError.message || t("Could not update name"));
    else {
      setNotice(t("Name updated."));
      setName("");
      await refetch();
    }
    setBusy(null);
  }

  async function downloadExport() {
    setBusy("export");
    setError("");
    try {
      const res = await fetch("/api/account");
      if (!res.ok) throw new Error(t("Could not export data"));
      const blob = new Blob([await res.text()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "deni-run-export.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not export data"));
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
      if (!res.ok) throw new Error(t("Could not delete account"));
      await authClient.signOut();
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not delete account"));
      setBusy(null);
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-background px-6 py-12 text-foreground">
      <Stagger className="mx-auto flex max-w-2xl flex-col gap-6">
        <StaggerItem>
        <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
          {t("Back to workspace")}
        </Link>
        </StaggerItem>
        <StaggerItem>
        <div>
          <h1 className="text-2xl font-semibold">{t("Account")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("{email} · signed in with Google or GitHub.", { email: user?.email ?? t("Signed in") })}
          </p>
        </div>
        </StaggerItem>

        <StaggerItem hover>
        <section className="rounded-xl border border-foreground/10 bg-surface p-5">
          <h2 className="text-[0.925rem] font-semibold">{t("Profile")}</h2>
          <div className="mt-4 flex flex-col gap-1.5">
            <Label htmlFor="display-name">{t("Name")}</Label>
            <Input
              id="display-name"
              value={name}
              placeholder={user?.name || t("Name")}
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
            {t("Save name")}
          </Button>
        </section>
        </StaggerItem>

        <StaggerItem hover>
        <section className="rounded-xl border border-foreground/10 bg-surface p-5">
          <h2 className="text-[0.925rem] font-semibold">{t("Two-factor authentication")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {user?.twoFactorEnabled
              ? t("An authenticator app is required after Google or GitHub sign-in.")
              : t("Finish setup so this account can open the workspace.")}
          </p>
          {user?.twoFactorEnabled ? (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  loading={busy === "2fa-codes"}
                  onClick={() => {
                    setBusy("2fa-codes");
                    setError("");
                    setNotice("");
                    void authClient.twoFactor.generateBackupCodes({}).then(({ data, error: nextError }) => {
                      if (nextError) setError(nextError.message || t("Could not generate backup codes"));
                      else {
                        setBackupCodes(data?.backupCodes ?? []);
                        setNotice(t("New backup codes replace any previous set."));
                      }
                      setBusy(null);
                    });
                  }}
                >
                  {t("Generate backup codes")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  loading={busy === "2fa-disable"}
                  onClick={() => {
                    setBusy("2fa-disable");
                    setError("");
                    void authClient.twoFactor.disable({}).then(async ({ error: nextError }) => {
                      if (nextError) setError(nextError.message || t("Could not disable two-factor"));
                      else {
                        setNotice(t("Two-factor authentication is off."));
                        setBackupCodes([]);
                        await refetch();
                        window.location.href = "/two-factor/setup";
                      }
                      setBusy(null);
                    });
                  }}
                >
                  {t("Disable two-factor")}
                </Button>
              </div>
              <BackupCodesPanel codes={backupCodes} />
            </div>
          ) : (
            <Button type="button" variant="secondary" className="mt-4" onClick={() => (window.location.href = "/two-factor/setup")}>
              {t("Set up authenticator app")}
            </Button>
          )}
        </section>
        </StaggerItem>

        <StaggerItem hover>
        <section className="rounded-xl border border-foreground/10 bg-surface p-5">
          <h2 className="text-[0.925rem] font-semibold">{t("Export")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Download teammates, conversations, skills, routines, and usage. API keys are redacted.")}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            loading={busy === "export"}
            onClick={() => void downloadExport()}
          >
            {t("Download JSON")}
          </Button>
        </section>
        </StaggerItem>
        <StaggerItem hover>
        <section className="rounded-xl border border-destructive-500/20 bg-surface p-5">
          <h2 className="text-[0.925rem] font-semibold text-destructive-300">{t("Delete account")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("This deletes your login, workspace files, conversations, teammates, and billing records. Type DELETE to confirm.")}
          </p>
          <Input
            className="mt-4"
            value={confirm}
            onChange={(event) => setConfirm(event.currentTarget.value)}
            placeholder="DELETE"
            aria-label={t("Type DELETE to confirm")}
          />
          <Button
            type="button"
            variant="destructive"
            className="mt-4"
            disabled={confirm !== "DELETE"}
            loading={busy === "delete"}
            onClick={() => void destroy()}
          >
            {t("Delete my account")}
          </Button>
        </section>
        </StaggerItem>
        {notice ? <StaggerItem><p className="text-sm text-secondary-foreground">{notice}</p></StaggerItem> : null}
        {error ? <StaggerItem><p className="text-sm text-destructive-300">{error}</p></StaggerItem> : null}
        <StaggerItem>
        <p className="text-sm text-muted-foreground">
          {t("Support:")}{" "}
          {mail ? (
            <a href={mail} className="text-secondary-foreground hover:text-foreground">
              {email}
            </a>
          ) : (
            t("set NEXT_PUBLIC_SUPPORT_EMAIL on this deployment.")
          )}
        </p>
        </StaggerItem>
      </Stagger>
    </main>
  );
}
