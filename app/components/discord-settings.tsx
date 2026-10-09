"use client";

import { useExtracted } from "next-intl";
import { CircleHelp } from "lucide-react";
import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button";

export type DiscordStatus = {
  configured: boolean;
  inviteUrl: string | null;
  link: { username: string; linkedAt: string } | null;
};
type LinkCode = { code: string; expiresAt: string };

export async function fetchDiscordStatus(): Promise<DiscordStatus | null> {
  try {
    const res = await fetch("/api/discord", { cache: "no-store" });
    return res.ok ? ((await res.json()) as DiscordStatus) : null;
  } catch {
    return null;
  }
}

/** Loaded by the Plugins dialog together with the other cards so they all appear at once. */
export function DiscordCard({ status, onStatusChange }: { status: DiscordStatus | null; onStatusChange: (status: DiscordStatus) => void }) {
  const t = useExtracted();
  const [issued, setIssued] = useState<LinkCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!status?.configured) return null;
  const current = status;
  const hint = t("Commands in the DM: /teammate chooses who you talk to, /unlink disconnects. Actions that need approval show Approve and Deny buttons.");

  async function createCode() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/discord", { method: "POST" });
      if (!res.ok) throw new Error(t("Could not create a code. Try again in a moment."));
      setIssued((await res.json()) as LinkCode);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!window.confirm(t("Unlink Discord? Messages from that account will no longer reach your teammates."))) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/discord", { method: "DELETE" });
      if (!res.ok) throw new Error(t("Could not unlink Discord."));
      onStatusChange({ ...current, link: null });
      setIssued(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-foreground/10 bg-surface-raised p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 font-semibold">
            Discord
            {status.link ? (
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button type="button" aria-label={hint} className="rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"><CircleHelp className="size-4" /></button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content side="bottom" align="start" sideOffset={6} collisionPadding={12} className="z-[70] max-w-xs rounded-xl border border-foreground/10 bg-surface-32 p-3 text-xs font-normal text-secondary-foreground shadow-xl outline-none">{hint}</Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            ) : null}
          </h3>
          <p className="text-xs text-muted-foreground">
            {status.link ? t("Linked to {name} · talk to teammates in Discord DMs", { name: status.link.username }) : t("Not linked")}
          </p>
        </div>
        {status.link ? (
          <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void unlink()}>{t("Unlink")}</Button>
        ) : (
          <Button type="button" size="sm" variant="primary" loading={busy} onClick={() => void createCode()}>{t("Create link code")}</Button>
        )}
      </div>
      {!status.link && issued ? (
        <div className="mt-3 space-y-2 border-t border-foreground/10 pt-3 text-sm">
          <p className="font-mono text-2xl font-semibold tracking-widest">{issued.code}</p>
          <p className="text-xs text-muted-foreground">
            {t("Send this code to the bot in a Discord direct message. It works once and expires in 10 minutes.")}
          </p>
          {status.inviteUrl ? (
            <a className="text-xs underline" href={status.inviteUrl} target="_blank" rel="noreferrer">{t("Open the bot on Discord")}</a>
          ) : null}
        </div>
      ) : null}
      {message ? <p className="mt-2 text-sm text-secondary-foreground">{message}</p> : null}
    </div>
  );
}
