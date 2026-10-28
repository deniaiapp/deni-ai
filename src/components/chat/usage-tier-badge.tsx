import { Coins } from "lucide-react";
import { useExtracted } from "use-intl";
import { getUsageTierMultiplier, type UsageTier } from "@/lib/constants";
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
