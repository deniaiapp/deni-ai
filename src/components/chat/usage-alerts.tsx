import { ArrowUpRight, Ban, TriangleAlert, Zap } from "lucide-react";
import { Link } from "@/lib/navigation";
import { useExtracted } from "use-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface UsageAlertsProps {
  status: {
    isAnonymous: boolean;
    /** The Free allowance is reduced until a payment method is verified. */
    isSignupLimited: boolean;
    isUsageLow: boolean;
    isUsageBlocked: boolean;
    canEnableMaxMode: boolean;
    /** Max Mode could carry on, but no prepaid credits are left. */
    needsMaxModeCredits: boolean;
    billingDisabled: boolean;
  };
  usage: {
    /** Share of the monthly pool left; percentages only, no amounts. */
    remainingPercent: number | null;
    tierLabel: string;
  };
  enableMaxMode: { mutate: () => void; isPending: boolean };
  onRefreshUsage: () => void;
}

export function UsageAlerts({ status, usage, enableMaxMode, onRefreshUsage }: UsageAlertsProps) {
  const t = useExtracted();
  const showVerifyCard = status.isSignupLimited && !status.isAnonymous && !status.billingDisabled;
  const offersMaxMode = status.canEnableMaxMode || status.needsMaxModeCredits;

  return (
    <>
      {(status.isUsageLow || status.isUsageBlocked) && (
        <Alert
          className={cn(
            "mt-3 border-amber-500/50 bg-amber-100/40 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-50",
            status.isUsageBlocked &&
              !offersMaxMode &&
              "border-destructive/40 bg-destructive/10 text-destructive-foreground dark:border-destructive/30",
            offersMaxMode &&
              "border-blue-500/50 bg-blue-100/40 text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-50",
          )}
        >
          {offersMaxMode ? (
            <Zap className="mt-0.5 size-4" />
          ) : status.isUsageBlocked ? (
            <Ban className="mt-0.5 size-4" />
          ) : (
            <TriangleAlert className="mt-0.5 size-4" />
          )}
          <AlertTitle>
            {status.canEnableMaxMode
              ? t("Enable Max Mode to continue")
              : status.needsMaxModeCredits
                ? t("Buy Max Mode credits to continue")
                : status.isUsageBlocked
                  ? t("Usage limit reached")
                  : t("You are running low")}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>
              {status.canEnableMaxMode
                ? t("You've reached your limit. Enable Max Mode to continue with your credits.")
                : status.needsMaxModeCredits
                  ? t(
                      "You've reached your limit. Buy prepaid Max Mode credits to keep going this month.",
                    )
                  : status.isUsageBlocked
                    ? t("You've hit this month's usage limit on your {tier} plan.", {
                        tier: usage.tierLabel,
                      })
                    : usage.remainingPercent === null
                      ? t("Only a little of this month's usage is left on your {tier} plan.", {
                          tier: usage.tierLabel,
                        })
                      : t("Only {percent}% of this month's usage is left on your {tier} plan.", {
                          percent: Math.max(usage.remainingPercent, 0.1).toFixed(1),
                          tier: usage.tierLabel,
                        })}
            </p>
            {showVerifyCard && (
              <p>
                {t(
                  "Your free allowance is currently limited. Verify a payment method to lift the limit. It is not charged.",
                )}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {showVerifyCard && (
                <Button size="sm" render={<Link href="/settings/billing" />} nativeButton={false}>
                  {t("Verify a card")}
                  <ArrowUpRight className="size-3.5" />
                </Button>
              )}
              {status.canEnableMaxMode && (
                <Button
                  size="sm"
                  onClick={() => enableMaxMode.mutate()}
                  disabled={enableMaxMode.isPending}
                >
                  {enableMaxMode.isPending && <Spinner />}
                  <Zap className="size-3.5" />
                  {t("Enable Max Mode")}
                </Button>
              )}
              {status.needsMaxModeCredits && (
                <Button size="sm" render={<Link href="/settings/billing" />} nativeButton={false}>
                  <Zap className="size-3.5" />
                  {t("Buy credits")}
                </Button>
              )}
              {!status.isAnonymous && !status.billingDisabled && !offersMaxMode && (
                <Button size="sm" render={<Link href="/settings/billing" />} nativeButton={false}>
                  {t("Upgrade plan")}
                  <ArrowUpRight className="size-3.5" />
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onRefreshUsage}>
                {t("Refresh usage")}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
