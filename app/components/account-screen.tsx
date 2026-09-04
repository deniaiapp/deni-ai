"use client";

import Link from "next/link";
import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supportEmail, supportMailto } from "@/lib/site";

export function AccountScreen() {
  const { signOut } = useClerk();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [error, setError] = useState("");
  const email = supportEmail();
  const mail = supportMailto();

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
      if (!res.ok) throw new Error("Could not delete account data");
      await signOut();
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account data");
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
            Export or delete the Deni Run data stored for this account.
          </p>
        </div>
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
          <h2 className="text-[0.925rem] font-semibold text-red-300">Delete account data</h2>
          <p className="mt-2 text-sm text-[#8f8f8f]">
            This removes workspace files, conversations, teammates, and billing records we store.
            Type DELETE to confirm. Your sign-in account at Clerk is separate.
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
            Delete my data
          </Button>
        </section>
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
