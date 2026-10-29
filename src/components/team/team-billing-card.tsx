import { useExtracted } from "use-intl";
import { useState } from "react";
import { PlanHighlights } from "@/components/billing/plan-highlights";
import { SubscriptionCancelDialog } from "@/components/billing/subscription-shredder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type TeamPlanId, isTeamPlanId } from "@/lib/billing";
import { useBillingPlanCopy } from "@/lib/billing-plan-copy";
import { formatCurrency, monthDayFormatter, monthDayYearFormatter } from "./team-utils";

type TeamPlan = {
  id: string;
  amount: number | null;
  currency: string | null;
};

type BillingStatus = {
  planId?: string | null;
  status?: string | null;
  memberCount?: number | null;
  currentPeriodEnd?: Date | string | null;
  cancelAt?: number | null;
};

type TeamPlanInterval = "monthly" | "yearly";

const TEAM_PLAN_IDS: Record<TeamPlanInterval, TeamPlanId> = {
  monthly: "pro_team_monthly",
  yearly: "pro_team_yearly",
};

/** Percent saved per seat by paying yearly, like the personal plan cards. */
function yearlySavingsPercent(monthly?: TeamPlan, yearly?: TeamPlan) {
  if (!monthly?.amount || !yearly?.amount || monthly.currency !== yearly.currency) return 0;
  return Math.max(
    0,
    Math.round(((monthly.amount * 12 - yearly.amount) / (monthly.amount * 12)) * 100),
  );
}

/** Pro for Teams with a monthly/yearly switch, like the personal plan cards. */
function TeamPlanOfferCard({
  plans,
  currentPlanId,
  checkoutPending,
  checkoutPlanId,
  changePending,
  changePlanId,
  canSwitch,
  onSelect,
}: {
  plans: TeamPlan[];
  currentPlanId: string | null;
  checkoutPending: boolean;
  checkoutPlanId?: string;
  changePending: boolean;
  changePlanId?: string;
  canSwitch: boolean;
  onSelect: (planId: TeamPlanId) => void;
}) {
  const t = useExtracted();
  const monthlyPlan = plans.find((plan) => plan.id === TEAM_PLAN_IDS.monthly);
  const yearlyPlan = plans.find((plan) => plan.id === TEAM_PLAN_IDS.yearly);
  // Opens on the interval the team pays now; otherwise monthly.
  const [chosenInterval, setChosenInterval] = useState<TeamPlanInterval>(
    currentPlanId === TEAM_PLAN_IDS.yearly ? "yearly" : "monthly",
  );
  const selectedInterval = chosenInterval === "yearly" && yearlyPlan ? "yearly" : "monthly";
  const plan = selectedInterval === "yearly" ? yearlyPlan : monthlyPlan;
  const planId = plan && isTeamPlanId(plan.id) ? plan.id : null;
  const copy = useBillingPlanCopy(planId);
  if (!plan || !planId || !copy) {
    return null;
  }

  const isYearly = selectedInterval === "yearly";
  const isCurrent = planId === currentPlanId;
  const savingsPercent = isYearly ? yearlySavingsPercent(monthlyPlan, yearlyPlan) : 0;
  const intervalLabel = isYearly ? t("year") : t("month");
  const isSelecting =
    (checkoutPending && checkoutPlanId === planId) || (changePending && changePlanId === planId);
  const busy = checkoutPending || changePending;

  return (
    <Card className="flex flex-col border-muted sm:max-w-md">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{t("Pro for Teams")}</CardTitle>
              {savingsPercent > 0 ? (
                <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  {t("Save {percent}%", { percent: savingsPercent.toString() })}
                </Badge>
              ) : copy.badge ? (
                <Badge variant="secondary" className="text-xs">
                  {copy.badge}
                </Badge>
              ) : null}
            </div>
            <CardDescription className="text-sm">{copy.tagline}</CardDescription>
          </div>
          {monthlyPlan && yearlyPlan ? (
            <Tabs
              value={selectedInterval}
              onValueChange={(value) => setChosenInterval(value as TeamPlanInterval)}
            >
              <TabsList className="h-8 rounded-xl">
                <TabsTrigger value="monthly" className="h-6 rounded-md px-3 text-xs">
                  {t("Monthly")}
                </TabsTrigger>
                <TabsTrigger value="yearly" className="h-6 rounded-md px-3 text-xs">
                  {t("Yearly")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : (
            <Badge variant="secondary" className="text-xs">
              {isYearly ? t("Yearly") : t("Monthly")}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col pt-0">
        <p className="text-2xl font-bold">
          {formatCurrency(plan.amount, plan.currency)}
          <span className="text-sm font-normal text-muted-foreground">
            /{t("seat")}/{intervalLabel}
          </span>
        </p>
        <PlanHighlights items={copy.highlights} className="mt-5 flex-1" />
        <Button
          className="mt-5 w-full"
          disabled={busy || isCurrent}
          onClick={() => onSelect(planId)}
        >
          {isSelecting ? <Spinner className="size-3.5" /> : null}
          {isCurrent ? t("Current plan") : canSwitch ? t("Switch") : t("Subscribe")}
        </Button>
      </CardContent>
    </Card>
  );
}

export function TeamBillingCard({
  isOwner,
  isLoading,
  billingStatus,
  plans,
  checkoutPending,
  checkoutPlanId,
  changePending,
  changePlanId,
  cancelPending,
  resumePending,
  onSubscribe,
  onChangePlan,
  onManage,
  onCancel,
  onResume,
}: {
  isOwner: boolean;
  isLoading: boolean;
  billingStatus?: BillingStatus | null;
  plans: TeamPlan[];
  checkoutPending: boolean;
  checkoutPlanId?: string;
  changePending: boolean;
  changePlanId?: string;
  cancelPending: boolean;
  resumePending: boolean;
  onSubscribe: (planId: TeamPlanId) => void;
  onChangePlan: (planId: TeamPlanId) => void;
  onManage: () => void;
  onCancel: () => void;
  onResume: () => void;
}) {
  const t = useExtracted();
  const hasActivePlan =
    billingStatus?.status &&
    ["active", "trialing", "past_due", "incomplete", "unpaid", "canceled"].includes(
      billingStatus.status,
    );
  const isCanceled = Boolean(billingStatus?.cancelAt) || billingStatus?.status === "canceled";
  const currentPlanId = billingStatus?.planId ?? null;
  const currentTitle = t("Pro for Teams");
  const canSwitch = Boolean(hasActivePlan && isOwner && !isCanceled);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("Team Billing")}</CardTitle>
        <CardDescription>
          {t("Team plans give every member Pro access with per-seat pricing.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Spinner />
        ) : hasActivePlan || isCanceled ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium mb-1.5">
                  {currentTitle}
                  {isCanceled && (
                    <Badge variant="secondary">
                      {t("Cancels")}{" "}
                      {billingStatus?.cancelAt
                        ? monthDayFormatter.format(new Date(billingStatus.cancelAt * 1000))
                        : billingStatus?.currentPeriodEnd
                          ? monthDayFormatter.format(new Date(billingStatus.currentPeriodEnd))
                          : ""}
                    </Badge>
                  )}
                  {hasActivePlan && !isCanceled && <Badge className="ml-1.5">{t("Active")}</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {billingStatus?.memberCount ?? 0} {t("seats")}
                  {billingStatus?.currentPeriodEnd &&
                    ` · ${t("Renews")} ${monthDayYearFormatter.format(new Date(billingStatus.currentPeriodEnd))}`}
                </p>
              </div>
              <div className="flex gap-2">
                {isOwner && (
                  <Button variant="outline" size="sm" onClick={onManage}>
                    {t("Manage")}
                  </Button>
                )}
                {isCanceled ? (
                  <Button size="sm" onClick={onResume} disabled={resumePending}>
                    {resumePending && <Spinner className="size-3.5" />}
                    {t("Resume")}
                  </Button>
                ) : (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setIsCancelConfirmOpen(true)}
                    disabled={cancelPending}
                  >
                    {cancelPending && <Spinner className="size-3.5" />}
                    {t("Cancel subscription")}
                  </Button>
                )}
              </div>
            </div>
            {isOwner && plans.length > 0 && !isCanceled ? (
              <TeamPlanOfferCard
                plans={plans}
                currentPlanId={currentPlanId}
                checkoutPending={checkoutPending}
                checkoutPlanId={checkoutPlanId}
                changePending={changePending}
                changePlanId={changePlanId}
                canSwitch={canSwitch}
                onSelect={canSwitch ? onChangePlan : onSubscribe}
              />
            ) : null}
          </div>
        ) : isOwner ? (
          <TeamPlanOfferCard
            plans={plans}
            currentPlanId={null}
            checkoutPending={checkoutPending}
            checkoutPlanId={checkoutPlanId}
            changePending={false}
            canSwitch={false}
            onSelect={onSubscribe}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("Ask a team owner to subscribe to a plan.")}
          </p>
        )}
      </CardContent>
      <SubscriptionCancelDialog
        open={isCancelConfirmOpen}
        onOpenChange={setIsCancelConfirmOpen}
        description={t(
          "The team plan stays active until the end of the current billing period, then ends for every member. You can resume it any time before then.",
        )}
        onConfirm={onCancel}
      />
    </Card>
  );
}
