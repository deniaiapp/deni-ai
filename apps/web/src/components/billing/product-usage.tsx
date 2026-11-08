import { Zap } from "lucide-react";
import { useExtracted, useLocale } from "use-intl";
import { formatAppDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

/** Mirrors `UsagePoolSnapshot` from src/lib/usage.ts as serialized by tRPC. */
export type UsagePoolView = {
  limit: number;
  used: { chat: number; flixa: number; run: number };
  periodEnd: Date | string;
};

type Segment = "chat" | "flixa" | "run";

const SEGMENTS: Segment[] = ["chat", "flixa", "run"];

/** One color per part of the pool, shared by the bar and its legend. */
const SEGMENT_COLORS: Record<Segment, string> = {
  chat: "bg-sky-500",
  flixa: "bg-violet-500",
  run: "bg-emerald-500",
};

function percentOf(value: number, limit: number) {
  return limit > 0 ? (value / limit) * 100 : 0;
}

function formatPercent(value: number) {
  return value.toFixed(1);
}

function poolShares(pool: UsagePoolView) {
  const shares = Object.fromEntries(
    SEGMENTS.map((segment) => [segment, percentOf(pool.used[segment], pool.limit)]),
  ) as Record<Segment, number>;
  const usedPercent = SEGMENTS.reduce((sum, segment) => sum + shares[segment], 0);
  return { shares, usedPercent };
}

function useSegmentLabels(): Record<Segment, string> {
  const t = useExtracted();
  return {
    chat: t("Deni AI Chat"),
    flixa: t("Flixa"),
    run: t("Deni Run"),
  };
}

/** The stacked bar: one colored part per segment, scaled to fit when over 100% (Max Mode). */
function StackedUsageBar({ pool, className }: { pool: UsagePoolView; className?: string }) {
  const t = useExtracted();
  const labels = useSegmentLabels();
  const { shares, usedPercent } = poolShares(pool);
  const scale = usedPercent > 100 ? 100 / usedPercent : 1;
  return (
    <div
      className={cn("flex h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="meter"
      aria-label={t("Monthly usage")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(Math.round(usedPercent), 100)}
    >
      {SEGMENTS.map((segment) =>
        shares[segment] > 0 ? (
          <div
            key={segment}
            className={cn("h-full transition-[width]", SEGMENT_COLORS[segment])}
            style={{ width: `${shares[segment] * scale}%` }}
            title={`${labels[segment]}: ${formatPercent(shares[segment])}%`}
          />
        ) : null,
      )}
    </div>
  );
}

/** Compact form for menus: the stacked bar and what is left of the pool. */
export function CombinedUsageBar({
  pool,
  maxModeEnabled,
}: {
  pool: UsagePoolView;
  maxModeEnabled?: boolean;
}) {
  const t = useExtracted();
  const { usedPercent } = poolShares(pool);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{t("Monthly usage")}</span>
        <span
          className={cn(
            "tabular-nums text-foreground/80",
            maxModeEnabled && "text-amber-600 dark:text-amber-400",
          )}
        >
          {maxModeEnabled
            ? t("Max Mode")
            : t("{percent}% left", { percent: Math.max(100 - usedPercent, 0).toFixed(0) })}
        </span>
      </div>
      <StackedUsageBar pool={pool} className="h-1" />
    </div>
  );
}

/**
 * The plan's single monthly pool, spent by Deni AI chat, Flixa, and Deni Run, as one
 * stacked bar colored by product. Shows percentages only.
 */
export function CombinedUsageMeter({
  pool,
  maxModeEnabled,
  className,
}: {
  pool: UsagePoolView;
  maxModeEnabled?: boolean;
  className?: string;
}) {
  const t = useExtracted();
  const locale = useLocale();
  const labels = useSegmentLabels();
  const { shares, usedPercent } = poolShares(pool);
  const remainingPercent = Math.max(100 - usedPercent, 0);
  const periodEndLabel = formatAppDate(pool.periodEnd, locale, { month: "short", day: "numeric" });

  return (
    <div className={cn("space-y-2 text-sm", className)}>
      <div className="flex items-center justify-between">
        <span>{t("Monthly usage")}</span>
        <span className="tabular-nums text-muted-foreground">
          {t("{percent}% used", { percent: formatPercent(usedPercent) })}
        </span>
      </div>
      <StackedUsageBar pool={pool} />
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {SEGMENTS.map((segment) => (
          <li key={segment} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", SEGMENT_COLORS[segment])} aria-hidden />
            {labels[segment]}
            <span className="tabular-nums">{formatPercent(shares[segment])}%</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {maxModeEnabled ? (
          <span className="flex items-center gap-1">
            <Zap className="size-3 text-blue-500" />
            {t("Max Mode active")}
          </span>
        ) : (
          <span>{t("{percent}% remaining", { percent: formatPercent(remainingPercent) })}</span>
        )}
        <span>{t("Resets {date}", { date: periodEndLabel })}</span>
      </div>
    </div>
  );
}
