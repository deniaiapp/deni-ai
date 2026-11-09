import { Clock } from "lucide-react";
import { useExtracted, useLocale } from "use-intl";
import type { ClientPlan, IndividualPlanId } from "@/lib/billing";
import { useBillingPlanCopy } from "@/lib/billing-plan-copy";
import { formatMinorCurrency } from "@/lib/currency";
import { useFormatPriceParts } from "@/lib/use-format-price-parts";
import { cn } from "@/lib/utils";
import { OfferCountdown } from "./offer-countdown";
import { PlanHighlights } from "./plan-highlights";
import {
  calculateYearlySavingsPercent,
  getOfferPercentOff,
  useFormatPriceLabel,
  useTierLabel,
} from "./billing-utils";
import { Badge } from "@deniai/ui/components/badge";
import { Button } from "@deniai/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@deniai/ui/components/card";
import { Spinner } from "@deniai/ui/components/spinner";
import { Tabs, TabsList, TabsTrigger } from "@deniai/ui/components/tabs";

export function PlanCard({
  plan,
  monthlyPlan,
  interval,
  onIntervalChange,
  status,
  cancelDate,
  activePlanId,
  changePlan,
  checkout,
  onChangePlanClick,
  onCheckout,
}: {
  plan: ClientPlan;
  monthlyPlan?: ClientPlan;
  interval?: "monthly" | "yearly";
  onIntervalChange?: (interval: "monthly" | "yearly") => void;
  status: {
    isCurrent: boolean;
    hasActiveSubscription: boolean;
    isLoadingEstimate: boolean;
    isOnTeamPlan?: boolean;
  };
  cancelDate: number | null;
  activePlanId: string | undefined;
  changePlan: { isPending: boolean; variables?: { planId: IndividualPlanId } };
  checkout: { isPending: boolean; variables?: { planId: IndividualPlanId } };
  onChangePlanClick: (plan: ClientPlan) => void;
  onCheckout: (planId: IndividualPlanId) => void;
}) {
  const t = useExtracted();
  const locale = useLocale();
  const formatPriceLabel = useFormatPriceLabel();
  const formatPriceParts = useFormatPriceParts();
  const getTierLabel = useTierLabel();
  const planCopy = useBillingPlanCopy(plan.id);
  const offerPercentOff = getOfferPercentOff(plan);
  const offer = offerPercentOff > 0 ? plan.limitedTimeOffer : null;
  const canChange = status.hasActiveSubscription && !cancelDate && !status.isCurrent;
  // Switching plans needs a renewing subscription.
  const isBlockedByCancel =
    Number.isInteger(cancelDate) && Boolean(activePlanId) && !status.isCurrent;
  const processing =
    (changePlan.isPending && changePlan.variables?.planId === plan.id) ||
    (checkout.isPending && checkout.variables?.planId === plan.id);
  const isLoadingThisPlan = status.isLoadingEstimate;

  const tierName = getTierLabel(plan.id);
  const priceParts =
    plan.amount && plan.currency ? formatPriceParts(plan.amount, plan.currency) : null;
  const monthlyEquivalent =
    interval === "yearly" && plan.amount && plan.currency
      ? formatMinorCurrency(
          Math.round(plan.amount / 12),
          plan.currency,
          {
            currencyDisplay: "code",
            maximumFractionDigits: 0,
          },
          locale,
        )
      : null;
  const savingsPercent =
    interval === "yearly" ? calculateYearlySavingsPercent(plan, monthlyPlan) : 0;
  const primaryActionLabel = status.isOnTeamPlan
    ? t("Team plan active")
    : status.isCurrent
      ? t("Current plan")
      : isBlockedByCancel
        ? t("Resume to change")
        : canChange
          ? t("Change plan")
          : t("Subscribe");
  // Reassurance for first-time buyers only; anyone already on a paid plan knows the terms.
  const showTrustCopy = !status.isOnTeamPlan && !activePlanId;

  return (
    // Narrow: a column (name, price, highlights, button). From `@xl/plans`: a wide
    // row with name, price and button on the left and the highlights on the right,
    // so the plans stack instead of squeezing three ~14rem columns side by side.
    <Card
      className={cn(
        "flex flex-col @xl/plans:grid @xl/plans:grid-cols-2 @xl/plans:grid-rows-[auto_auto_1fr] @xl/plans:gap-x-8 @xl/plans:px-(--card-spacing)",
        interval === "yearly" && "border-foreground/20 bg-muted/20",
        offer &&
          "border-amber-500/50 ring-2 ring-amber-500/25 dark:ring-amber-500/25 next:border-highlight next:ring-highlight/40",
        status.isCurrent && "border-foreground ring-1 ring-foreground/10",
      )}
    >
      <CardHeader className="pb-4 @xl/plans:col-start-1 @xl/plans:row-start-1 @xl/plans:px-0 @xl/plans:pb-0">
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="font-semibold">{tierName}</CardTitle>
              {offer ? (
                <Badge className="border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300 next:border-transparent next:bg-highlight next:text-highlight-foreground">
                  {t("{percent}% off", { percent: offerPercentOff.toString() })}
                </Badge>
              ) : interval === "yearly" && savingsPercent > 0 ? (
                <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 next:border-transparent next:bg-success/15 next:text-success">
                  {t("Save {percent}%", { percent: savingsPercent.toString() })}
                </Badge>
              ) : planCopy.badge ? (
                <Badge variant="secondary" className="text-xs">
                  {planCopy.badge}
                </Badge>
              ) : null}
            </div>
            <CardDescription className="text-sm leading-relaxed">
              {planCopy.tagline}
            </CardDescription>
          </div>
          {/* A plan sold monthly only (Go) has no interval to switch. */}
          {onIntervalChange ? (
            <Tabs
              value={interval}
              onValueChange={(v) => onIntervalChange?.(v as "monthly" | "yearly")}
            >
              <TabsList className="h-8 rounded-xl">
                <TabsTrigger value="monthly" className="h-6 px-3 text-xs rounded-md">
                  {t("Monthly")}
                </TabsTrigger>
                <TabsTrigger value="yearly" className="h-6 px-3 text-xs rounded-md">
                  {t("Yearly")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : (
            <Badge variant="secondary" className="text-xs">
              {t("Monthly")}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col pt-0 @xl/plans:contents">
        <div className="flex-1 @xl/plans:contents">
          <div className="space-y-3 @xl/plans:col-start-1 @xl/plans:row-start-2">
            {priceParts ? (
              <div className="space-y-1">
                <div className="flex items-start gap-2">
                  <span className="pt-2 text-[11px] font-semibold text-muted-foreground uppercase">
                    {priceParts.currency}
                  </span>
                  <span className="text-4xl font-semibold tracking-tight">{priceParts.amount}</span>
                  {plan.interval && (
                    <span className="pt-3 text-sm text-muted-foreground">
                      /
                      {plan.interval === "month"
                        ? t("month")
                        : plan.interval === "year"
                          ? t("year")
                          : plan.interval}
                    </span>
                  )}
                </div>
                {plan.originalAmount && plan.currency && (
                  <p className="text-sm text-muted-foreground line-through">
                    {formatMinorCurrency(
                      plan.originalAmount,
                      plan.currency,
                      {
                        currencyDisplay: "code",
                        maximumFractionDigits: 0,
                      },
                      locale,
                    )}
                  </p>
                )}
              </div>
            ) : (
              <div className="text-2xl font-semibold tracking-tight">{formatPriceLabel(plan)}</div>
            )}
            {interval === "yearly" && monthlyEquivalent && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {t("{amount}/month when billed yearly", {
                    amount: monthlyEquivalent,
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("One yearly payment of {price}", {
                    price: formatPriceLabel(plan),
                  })}
                </p>
              </div>
            )}
            {offer?.kind === "timer" && (
              <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 next:text-foreground">
                <Clock className="size-4" />
                <span>{t("Offer ends in")}</span>
                <OfferCountdown endsAt={offer.endsAt} className="font-mono font-semibold" />
              </div>
            )}
          </div>
          <PlanHighlights
            items={planCopy.highlights}
            className="mt-5 @xl/plans:col-start-2 @xl/plans:row-span-3 @xl/plans:row-start-1 @xl/plans:mt-0 @xl/plans:border-l @xl/plans:pl-8"
          />
        </div>
        <Button
          className="mt-6 h-auto min-h-12 w-full flex-col gap-1 py-3 font-medium @xl/plans:col-start-1 @xl/plans:row-start-3 @xl/plans:mt-0 @xl/plans:self-end"
          variant={status.isCurrent ? "secondary" : "default"}
          disabled={
            status.isCurrent ||
            processing ||
            isBlockedByCancel ||
            isLoadingThisPlan ||
            status.isOnTeamPlan
          }
          onClick={() => {
            if (canChange) {
              onChangePlanClick(plan);
            } else {
              onCheckout(plan.id as IndividualPlanId);
            }
          }}
        >
          {(processing || isLoadingThisPlan) && <Spinner className="size-4" />}
          <span>{primaryActionLabel}</span>
          {showTrustCopy && (
            <span className="text-[11px] font-normal text-current/80">{t("Cancel anytime")}</span>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
