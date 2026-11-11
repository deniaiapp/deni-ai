import { Coins, Sparkles } from "lucide-react";
import { useExtracted, useLocale } from "use-intl";
import { getUsagePromotion, getUsageTierMultiplier, type UsageTier } from "@deniai/ai/models";
import { formatAppDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

/** "Tier N" for models whose tokens count more than once toward usage (Tier 2 and above). */
export function UsageTierBadge({
  tier,
  compact = false,
  className,
}: {
  tier: UsageTier | undefined;
  /** Icon only, for tight spaces such as the composer trigger. */
  compact?: boolean;
  className?: string;
}) {
  const t = useExtracted();
  if (!tier || tier <= 1) return null;
  const description = t("Tier {tier}: each token counts {multiplier}× toward your usage", {
    tier: String(tier),
    multiplier: String(getUsageTierMultiplier(tier)),
  });
  return (
    <span
      className={cn(
        "inline-flex h-auto items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none bg-amber-500/15 text-amber-700 dark:text-amber-400",
        className,
      )}
      title={description}
      aria-label={description}
    >
      <Coins className="size-3" aria-hidden="true" />
      {compact ? tier : t("Tier {tier}", { tier: String(tier) })}
    </span>
  );
}

/** "50% off" while a usage promotion (`USAGE_PROMOTIONS`) runs for the model. */
export function UsagePromotionBadge({
  model,
  compact = false,
  className,
}: {
  model: string | undefined;
  /** Percentage only, for tight spaces such as the composer trigger. */
  compact?: boolean;
  className?: string;
}) {
  const t = useExtracted();
  const locale = useLocale();
  const promotion = model ? getUsagePromotion(model) : null;
  if (!promotion) return null;
  const percent = String(Math.round((1 - promotion.factor) * 100));
  // The last day it applies (`endsAt` is the first moment it no longer does).
  const lastDay = formatAppDate(new Date(promotion.endsAt.getTime() - 1), locale, {
    month: "short",
    day: "numeric",
  });
  const description = t("v8 launch: {percent}% off usage until {date}", {
    percent,
    date: lastDay,
  });
  return (
    <span
      className={cn(
        "inline-flex h-auto items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        className,
      )}
      title={description}
      aria-label={description}
    >
      <Sparkles className="size-3" aria-hidden="true" />
      {compact ? `-${percent}%` : t("{percent}% off", { percent })}
    </span>
  );
}
