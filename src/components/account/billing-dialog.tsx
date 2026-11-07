import { useExtracted } from "@/i18n/react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { LoadingFallback } from "@/components/ui/loading";
import { authClient } from "@/lib/auth/client";
import { easeOut } from "@/lib/ui/motion";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { UsageSnapshot } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { useState } from "react";

type PoolPart = keyof UsageSnapshot["pool"]["parts"];

const POOL_PARTS: PoolPart[] = ["chat", "flixa", "run"];

/** Same colors as Deni AI's usage view, so each part reads the same in both apps. */
const POOL_PART_COLORS: Record<PoolPart, string> = {
  chat: "bg-sky-500",
  flixa: "bg-violet-500",
  run: "bg-emerald-500",
};

/** The shared monthly pool as one stacked bar with a legend; percentages only. */
function PoolMeter({ pool }: { pool: UsageSnapshot["pool"] }) {
  const t = useExtracted();
  const labels: Record<PoolPart, string> = {
    chat: t("Deni AI Chat"),
    flixa: t("Flixa"),
    run: t("Deni Run"),
  };
  const scale = pool.usedPercent > 100 ? 100 / pool.usedPercent : 1;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-sm">
        <span className="text-secondary-foreground">{t("Monthly usage")}</span>
        <span className="text-muted-foreground">
          {t("{percent}% used", { percent: pool.usedPercent.toFixed(1) })}
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-foreground/10">
        {POOL_PARTS.map((part) =>
          pool.parts[part] > 0 ? (
            <motion.div
              key={part}
              className={cn("h-full", POOL_PART_COLORS[part])}
              initial={{ width: 0 }}
              animate={{ width: `${pool.parts[part] * scale}%` }}
              transition={{ duration: 0.5, ease: easeOut }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {POOL_PARTS.map((part) => (
          <li key={part} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", POOL_PART_COLORS[part])} aria-hidden />
            {labels[part]} {pool.parts[part].toFixed(1)}%
          </li>
        ))}
      </ul>
    </div>
  );
}

function Meter({
  label,
  used,
  limit,
  format = String,
}: {
  label: string;
  used: number;
  limit: number;
  format?: (value: number) => string;
}) {
  const pct = limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span className="text-secondary-foreground">{label}</span>
        <span className="text-muted-foreground">
          {format(used)} / {format(limit)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <motion.div
          className={`h-full rounded-full ${pct >= 100 ? "bg-destructive-400" : "bg-sidebar-primary"}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: easeOut }}
        />
      </div>
    </div>
  );
}

/** Starts linking a Deni AI account; returns to the workspace when done. */
export function useConnectDeniAi() {
  const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true);
    const { error } = await authClient.linkSocial({ provider: "deni-ai", callbackURL: "/" });
    if (error) setBusy(false);
  }
  return { busy, connect };
}

/** Deni Run usage against the Deni AI plan; the plan itself is managed in Deni AI. */
export function BillingDialog({
  open,
  usage,
  onClose,
}: {
  open: boolean;
  usage: UsageSnapshot | null;
  onClose: () => void;
}) {
  const t = useExtracted();
  const { busy, connect } = useConnectDeniAi();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="p-6">
        <div className="mb-4">
          <DialogTitle className="text-lg font-semibold">{t("Plan and usage")}</DialogTitle>
        </div>
        {usage && !usage.linked ? (
          <p className="text-sm text-muted-foreground">
            {t("Deni Run uses the plan of your Deni AI account. Connect one to keep using teammates, the browser, and the computer.")}
          </p>
        ) : usage ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {t("Deni AI {plan} plan · {period} UTC", { plan: usage.planName, period: usage.period })}
              {usage.periodEnd
                ? ` · ${t("resets {date}", { date: new Date(usage.periodEnd).toLocaleDateString() })}`
                : null}
            </p>
            {usage.metered ? (
              <PoolMeter pool={usage.pool} />
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("Usage is not metered on this deployment.")}
              </p>
            )}
            <Meter label={t("Teammates")} used={usage.teammates.used} limit={usage.teammates.limit} />
          </div>
        ) : (
          <LoadingFallback label={t("Loading usage…")} className="py-8" />
        )}
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose render={<Button variant="secondary" />}>{t("Close")}</DialogClose>
          {usage && !usage.linked ? (
            <Button type="button" variant="primary" loading={busy} onClick={() => void connect()}>
              {t("Connect Deni AI account")}
            </Button>
          ) : usage ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => window.open(usage.manageUrl, "_blank", "noopener,noreferrer")}
            >
              {t("Manage plan on Deni AI")}
            </Button>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("Your Deni AI plan covers Deni AI chat, Flixa, and Deni Run. See all usage in Deni AI settings.")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
