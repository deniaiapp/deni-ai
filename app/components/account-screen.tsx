"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { supportEmail, supportMailto } from "@/lib/site";

export function AccountScreen() {
  const { data: session, refetch } = authClient.useSession();
  const user = session?.user;
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState("");
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
    if (nextError) setError(nextError.message || "Could not update name");
    else {
      setNotice("Name updated.");
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
            {user?.email ?? "Signed in"} · signed in with Google or GitHub.
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
