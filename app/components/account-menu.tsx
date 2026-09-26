"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CreditCard, Download, Loader2, LogOut, Sparkles, Trash2, UserRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { UsageSnapshot } from "@/lib/plans";

export function AccountMenu({
  usage,
  onOpenBilling,
}: {
  usage: UsageSnapshot | null;
  onOpenBilling: () => void;
}) {
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<"export" | "delete" | "signout" | null>(null);
  const [error, setError] = useState("");
  const name = user?.name || user?.email || "Account";
  const onPro = usage?.plan === "pro";
  const remainingPercent = usage
    ? usage.tokens.limit > 0
      ? Math.round(Math.max(0, Math.min(100, (1 - usage.tokens.used / usage.tokens.limit) * 100)))
      : 0
    : null;
  const exporting = busy === "export";
  const signingOut = busy === "signout";

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
      setMenuOpen(false);
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
      await authClient.signOut();
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account data");
      setBusy(null);
    }
  }

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(next) => {
          if (exporting || signingOut) return;
          setMenuOpen(next);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-foreground/5"
          >
            {user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt=""
                className="size-8 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs text-foreground">
                {name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="min-w-0 truncate text-sm text-foreground">{name}</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {usage
                  ? `${usage.planName} · ${remainingPercent}% remaining`
                  : "Account"}
              </span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuLabel>
            {user?.email ?? "Signed in"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={exporting || signingOut}
            onSelect={() => {
              onOpenBilling();
            }}
          >
            <CreditCard />
            Plan and usage
          </DropdownMenuItem>
          {onPro ? null : (
            <DropdownMenuItem disabled={exporting || signingOut} onSelect={() => router.push("/upgrade")}>
              <Sparkles />
              Upgrade to Pro
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={exporting || signingOut} onSelect={() => router.push("/account")}>
            <UserRound />
            Manage profile
          </DropdownMenuItem>
          <DropdownMenuItem
            aria-busy={exporting}
            onSelect={(event) => {
              event.preventDefault();
              if (busy) return;
              void downloadExport();
            }}
          >
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            {exporting ? "Exporting…" : "Export data"}
          </DropdownMenuItem>
          {error && !deleteOpen ? <p className="px-2 py-1 text-xs text-destructive-300">{error}</p> : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={exporting || signingOut}
            onSelect={() => {
              setConfirm("");
              setError("");
              setDeleteOpen(true);
            }}
          >
            <Trash2 />
            Delete account
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={exporting || signingOut}
            onSelect={(event) => {
              event.preventDefault();
              if (busy) return;
              setBusy("signout");
              void authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    window.location.href = "/";
                  },
                },
              });
            }}
          >
            {signingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={deleteOpen}
        onOpenChange={(next) => {
          if (!next) setDeleteOpen(false);
        }}
      >
        <DialogContent className="p-6">
          <DialogTitle className="text-lg font-semibold">Delete account</DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            This deletes your login, workspace files, conversations, teammates, and billing
            records. Type DELETE to confirm.
          </p>
          <Input
            className="mt-4"
            value={confirm}
            onChange={(event) => setConfirm(event.currentTarget.value)}
            placeholder="DELETE"
            aria-label="Type DELETE to confirm"
          />
          {error ? <p className="mt-2 text-sm text-destructive-300">{error}</p> : null}
          <div className="mt-6 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={confirm !== "DELETE"}
              loading={busy === "delete"}
              onClick={() => void destroy()}
            >
              Delete my data
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
