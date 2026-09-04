"use client";

import { Button } from "@/components/ui/button";
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
        <span className="text-[#c8c8c8]">{label}</span>
        <span className="text-[#8f8f8f]">
          {format(used)} / {format(limit)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${pct >= 100 ? "bg-red-400" : "bg-[#f0f0f0]"}`}
          style={{ width: `${pct}%` }}
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
          <DialogTitle className="text-lg font-semibold">Plan and usage</DialogTitle>
        </div>
        {usage ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[#8f8f8f]">
              {usage.planName} plan · {usage.period} UTC
              {usage.currentPeriodEnd
                ? ` · renews ${new Date(usage.currentPeriodEnd).toLocaleDateString()}`
                : null}
            </p>
            <Meter
              label="Tokens"
              used={usage.tokens.used}
              limit={usage.tokens.limit}
              format={formatTokenCount}
            />
            <Meter
              label="Browser minutes"
              used={usage.browserMinutes.used}
              limit={usage.browserMinutes.limit}
            />
            <Meter
              label="Computer minutes"
              used={usage.computerMinutes.used}
              limit={usage.computerMinutes.limit}
            />
            <Meter label="Teammates" used={usage.teammates.used} limit={usage.teammates.limit} />
          </div>
        ) : (
          <p className="text-sm text-[#8f8f8f]">Loading usage…</p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary">Close</Button>
          </DialogClose>
          {usage?.plan === "pro" ? (
            <Button type="button" variant="primary" loading={busy} onClick={onManage}>
              Manage billing
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              loading={busy}
              onClick={onUpgrade}
              disabled={!usage?.stripeConfigured}
            >
              Upgrade to Pro · ${pro.priceUsd}/mo
            </Button>
          )}
        </div>
        {usage && usage.plan === "free" && !usage.stripeConfigured ? (
          <p className="mt-3 text-xs text-[#8f8f8f]">
            Stripe is not configured on this deployment. Limits still apply to the Free plan.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
