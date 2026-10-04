"use client";

import { useExtracted } from "next-intl";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { LoadingFallback } from "@/components/ui/loading";
import { easeOut } from "@/lib/motion";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { UsageSnapshot } from "@/lib/plans";
import { formatTokenCount, PLANS } from "@/lib/plans";

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

export function BillingDialog({
  open,
  usage,
  busy,
  onClose,
  onUpgrade,
  onManage,
}: {
  open: boolean;
  usage: UsageSnapshot | null;
  busy: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  onManage: () => void;
}) {
  const t = useExtracted();
  const pro = PLANS.pro;
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
        {usage ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {t("{plan} plan · {period} UTC", { plan: usage.planName, period: usage.period })}
              {usage.currentPeriodEnd
                ? ` · ${t("renews {date}", { date: new Date(usage.currentPeriodEnd).toLocaleDateString() })}`
                : null}
            </p>
            <Meter
              label={t("Tokens")}
              used={usage.tokens.used}
              limit={usage.tokens.limit}
              format={formatTokenCount}
            />
            <Meter
              label={t("Browser minutes")}
              used={usage.browserMinutes.used}
              limit={usage.browserMinutes.limit}
            />
            <Meter
              label={t("Computer minutes")}
              used={usage.computerMinutes.used}
              limit={usage.computerMinutes.limit}
            />
            <Meter label={t("Teammates")} used={usage.teammates.used} limit={usage.teammates.limit} />
          </div>
        ) : (
          <LoadingFallback label={t("Loading usage…")} className="py-8" />
        )}
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary">{t("Close")}</Button>
          </DialogClose>
          {usage?.plan === "pro" ? (
            <Button type="button" variant="primary" loading={busy} onClick={onManage}>
              {t("Manage billing")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              loading={busy}
              onClick={onUpgrade}
              disabled={!usage?.stripeConfigured}
            >
              {t("Upgrade to Pro · ${price}/mo", { price: String(pro.priceUsd) })}
            </Button>
          )}
        </div>
        {usage && usage.plan === "free" && !usage.stripeConfigured ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("Stripe is not configured on this deployment. Limits still apply to the Free plan.")}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
