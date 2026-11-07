import { useExtracted } from "@/i18n/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Stagger, StaggerItem } from "@/components/common/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackupCodesPanel, usePasskeyErrorMessage } from "./auth-form";
import { authClient } from "@/lib/auth/client";
import { supportEmail, supportMailto } from "@/lib/site";

export function AccountScreen({ deniAiUrl }: { deniAiUrl: string }) {
  const t = useExtracted();
  const { data: session, refetch } = authClient.useSession();
  const [deniAiLinked, setDeniAiLinked] = useState<boolean | null>(null);
  const user = session?.user;
  const usesAuthenticator = user?.twoFactorMethod !== "email" && user?.twoFactorMethod !== "passkey";
  const passkeyError = usePasskeyErrorMessage();
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const email = supportEmail();
  const mail = supportMailto();

  useEffect(() => {
    let cancelled = false;
    void authClient.listAccounts().then(({ data }) => {
      if (!cancelled) setDeniAiLinked(Boolean(data?.some((item) => item.providerId === "deni-ai")));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function connectDeniAi() {
    setBusy("deni-ai");
    setError("");
    const { error: nextError } = await authClient.linkSocial({
      provider: "deni-ai",
      callbackURL: "/account",
      errorCallbackURL: "/account",
    });
    if (nextError) {
      setError(nextError.message || t("Could not connect your Deni AI account"));
      setBusy(null);
    }
  }

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
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
          {t("Back to workspace")}
        </Link>
        </StaggerItem>
        <StaggerItem>
        <div>
          <h1 className="text-2xl font-semibold">{t("Account")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("{email} · signed in with Deni AI, Google, or GitHub.", { email: user?.email ?? t("Signed in") })}
          </p>
        </div>
        </StaggerItem>

        <StaggerItem hover>
        <section className="rounded-xl border border-foreground/10 bg-surface p-5">
          <h2 className="text-[0.925rem] font-semibold">{t("Deni AI account")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {deniAiLinked
              ? t("Connected. Your plan and Deni Run usage are managed in Deni AI, next to Deni AI chat and Flixa.")
              : t("Deni Run uses the plan of your Deni AI account. Connect one to keep using teammates, the browser, and the computer.")}
          </p>
          {deniAiLinked ? (
            <a
              href={`${deniAiUrl}/settings/billing`}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex h-8 items-center rounded-lg bg-foreground/10 px-3 text-sm hover:bg-foreground/15"
            >
              {t("Manage plan and usage")}
            </a>
          ) : (
            <Button
              type="button"
              variant="primary"
              className="mt-4"
              loading={busy === "deni-ai"}
              disabled={deniAiLinked === null}
              onClick={() => void connectDeniAi()}
            >
              {t("Connect Deni AI account")}
            </Button>
          )}
        </section>
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
            {!user?.twoFactorEnabled
              ? t("Finish setup so this account can open the workspace.")
              : user.twoFactorMethod === "email"
                ? t("A code sent to {email} is required after you sign in.", { email: user.email })
                : user.twoFactorMethod === "passkey"
                  ? t("You confirm with a passkey after you sign in. Add one on a second device in case you lose this one.")
                  : t("An authenticator app is required after you sign in.")}
          </p>
          {user?.twoFactorEnabled ? (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {usesAuthenticator ? (
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
                ) : null}
                {user.twoFactorMethod === "passkey" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={busy === "passkey-add"}
                    onClick={() => {
                      setBusy("passkey-add");
                      setError("");
                      setNotice("");
                      void authClient.passkey.addPasskey().then(({ error: nextError }) => {
                        if (nextError) setError(passkeyError(nextError, t("Could not add the passkey")));
                        else setNotice(t("Passkey added."));
                        setBusy(null);
                      });
                    }}
                  >
                    {t("Add a passkey")}
                  </Button>
                ) : null}
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
                  {t("Change two-factor method")}
                </Button>
              </div>
              <BackupCodesPanel codes={backupCodes} />
            </div>
          ) : (
            <Button type="button" variant="secondary" className="mt-4" onClick={() => (window.location.href = "/two-factor/setup")}>
              {t("Set up two-factor")}
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
