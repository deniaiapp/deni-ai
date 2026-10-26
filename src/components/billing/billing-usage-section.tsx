"use client";

import { Zap } from "lucide-react";
import { useExtracted, useLocale } from "next-intl";
import { formatAppDate } from "@/lib/format-date";
import { formatCompactUsageValue } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Progress } from "../ui/progress";
import { Spinner } from "../ui/spinner";
import { AttachmentStorageUsage } from "./attachment-storage-usage";
import { CombinedUsageMeter, type UsagePoolView } from "./product-usage";

export type UsageItem = {
  category: "basic" | "premium";
  unit: "requests" | "tokens";
  limit: number | null;
  used: number;
  remaining: number | null;
  periodEnd: Date | string | null;
};

function UsageRow({
  label,
  item,
  maxModeEnabled,
}: {
  label: string;
  item: UsageItem | undefined;
  maxModeEnabled?: boolean;
}) {
  const t = useExtracted();
  const locale = useLocale();
  if (!item) return null;

  const unitLabel = item.unit === "tokens" ? t("tokens") : t("requests");
  const hasLimit = item.limit !== null && item.limit > 0;
  const usedPercent = hasLimit ? Math.min((item.used / (item.limit ?? 1)) * 100, 100) : 0;
  const remainingPercent = Math.max(100 - usedPercent, 0);
  const compactUsageLabel = hasLimit
    ? t("{percent}% used", { percent: usedPercent.toFixed(1) })
    : `${formatCompactUsageValue(item.used)} ${unitLabel}`;

  // When Max Mode is enabled, show as unlimited
  if (maxModeEnabled) {
    const periodEndLabel = item.periodEnd
      ? formatAppDate(item.periodEnd, locale, { month: "short", day: "numeric" })
      : null;

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span>{label}</span>
          <span className="text-muted-foreground">{compactUsageLabel}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Zap className="size-3 text-blue-500" />
            {t("Max Mode active")}
          </span>
          {periodEndLabel && <span>{t("Resets {date}", { date: periodEndLabel })}</span>}
        </div>
      </div>
    );
  }

  const progress =
    item.limit === null || item.limit === 0 ? 0 : Math.min((item.used / item.limit) * 100, 100);
  const remainingLabel = hasLimit
    ? t("{percent}% remaining", { percent: remainingPercent.toFixed(1) })
    : t("Unlimited");
  const periodEndLabel = item.periodEnd
    ? formatAppDate(item.periodEnd, locale, { month: "short", day: "numeric" })
    : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">{compactUsageLabel}</span>
      </div>
      <Progress value={progress} className="h-2" />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{remainingLabel}</span>
        {periodEndLabel && <span>{t("Resets {date}", { date: periodEndLabel })}</span>}
      </div>
    </div>
  );
}

export function BillingUsageSection({
  usageTierLabel,
  isLoading,
  errorMessage,
  usageItem,
  maxModeEnabled,
  pool,
}: {
  usageTierLabel: string;
  isLoading: boolean;
  errorMessage?: string | null;
  usageItem: UsageItem | undefined;
  maxModeEnabled?: boolean;
  /** The pool shared by Deni AI chat, Flixa, and Deni Run; null for guests. */
  pool?: UsagePoolView | null;
}) {
  const t = useExtracted();

  return (
    <Card>
      <CardHeader className="gap-0!">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium">{t("Usage")}</CardTitle>
            <CardDescription>{t("Tier: {tier}", { tier: usageTierLabel })}</CardDescription>
          </div>
          <Badge variant="secondary">{usageTierLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : errorMessage ? (
          <p className="text-sm text-destructive">{errorMessage}</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {pool ? (
              <CombinedUsageMeter pool={pool} maxModeEnabled={maxModeEnabled} />
            ) : (
              <UsageRow label={t("Usage")} item={usageItem} maxModeEnabled={maxModeEnabled} />
            )}
            <AttachmentStorageUsage />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
