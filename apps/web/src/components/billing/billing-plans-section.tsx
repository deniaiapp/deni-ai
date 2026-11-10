import { Users } from "lucide-react";
import { Link } from "@/lib/navigation";
import { useExtracted } from "use-intl";
import type { ClientPlan, IndividualPlanId } from "@/lib/billing";
import { useTeamPlanHighlights } from "@/lib/billing-plan-copy";
import { cn } from "@/lib/utils";
import { PlanCard } from "./billing-plan-card";
import { BILLING_PLANS_SECTION_ID } from "./billing-utils";
import { PlanHighlights } from "./plan-highlights";
import { Badge } from "@deniai/ui/components/badge";
import { Button } from "@deniai/ui/components/button";
import {
  PageSection,
  PageSectionContent,
  PageSectionHeader,
  PageSectionTitle,
} from "@deniai/ui/components/page-section";
import { Tabs, TabsList, TabsTrigger } from "@deniai/ui/components/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@deniai/ui/components/card";

type PlanActionProps = {
  activePlanId: string | undefined;
  isSubscribed: boolean;
  hasActiveSubscription: boolean;
  isOnTeamPlan: boolean;
  pendingPlanId: IndividualPlanId | null;
  isEstimateLoading: boolean;
  cancelDate: number | null;
  changePlan: { isPending: boolean; variables?: { planId: IndividualPlanId } };
  checkout: { isPending: boolean; variables?: { planId: IndividualPlanId } };
  onChangePlanClick: (plan: ClientPlan) => void;
  onCheckout: (planId: IndividualPlanId) => void;
};

export function BillingPlansSection({
  erroredMessage,
  hasActiveSubscription,
  goMonthly,
  selectedPlusPlan,
  plusMonthly,
  selectedProPlan,
  proMonthly,
  interval,
  onIntervalChange,
  isOnTeamPlan,
  isEducation,
  planActions,
}: {
  erroredMessage?: string | null;
  hasActiveSubscription: boolean;
  goMonthly?: ClientPlan;
  selectedPlusPlan?: ClientPlan;
  plusMonthly?: ClientPlan;
  selectedProPlan?: ClientPlan;
  proMonthly?: ClientPlan;
  /** Billing interval shown for every plan; Go is sold monthly only. */
  interval: "monthly" | "yearly";
  onIntervalChange: (interval: "monthly" | "yearly") => void;
  isOnTeamPlan: boolean;
  /** Go comes free with a verified educational address, so it is the current plan. */
  isEducation: boolean;
  planActions: PlanActionProps;
}) {
  const t = useExtracted();
  const teamHighlights = useTeamPlanHighlights();
  const {
    activePlanId,
    isSubscribed,
    pendingPlanId,
    isEstimateLoading,
    cancelDate,
    changePlan,
    checkout,
    onChangePlanClick,
    onCheckout,
  } = planActions;

  return (
    <PageSection layout="stacked">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageSectionHeader>
          <PageSectionTitle>{t("Plans")}</PageSectionTitle>
        </PageSectionHeader>
        {!erroredMessage && (
          <Tabs
            value={interval}
            onValueChange={(value) => onIntervalChange(value as "monthly" | "yearly")}
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
        )}
      </div>
      <PageSectionContent>
        {erroredMessage ? (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle>{t("Error")}</CardTitle>
              <CardDescription>{erroredMessage}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            {/* Plan cards follow this section's width, not the viewport's: the app sidebar
          and the settings nav take a large, varying share of the screen. */}
            <div id={BILLING_PLANS_SECTION_ID} className="@container/plans scroll-mt-6 space-y-4">
              <div className="grid gap-4 @3xl/plans:grid-cols-3">
                {goMonthly && (
                  <PlanCard
                    plan={goMonthly}
                    monthlyOnly={interval === "yearly"}
                    status={{
                      isCurrent:
                        (goMonthly.id === activePlanId && isSubscribed) ||
                        (isEducation && !isSubscribed),
                      hasActiveSubscription,
                      isLoadingEstimate: pendingPlanId === goMonthly.id && isEstimateLoading,
                      isOnTeamPlan,
                    }}
                    cancelDate={cancelDate}
                    activePlanId={activePlanId}
                    changePlan={changePlan}
                    checkout={checkout}
                    onChangePlanClick={onChangePlanClick}
                    onCheckout={onCheckout}
                  />
                )}

                {selectedPlusPlan && (
                  <PlanCard
                    plan={selectedPlusPlan}
                    monthlyPlan={plusMonthly}
                    interval={interval}
                    status={{
                      isCurrent: selectedPlusPlan.id === activePlanId && isSubscribed,
                      hasActiveSubscription,
                      isLoadingEstimate: pendingPlanId === selectedPlusPlan.id && isEstimateLoading,
                      isOnTeamPlan,
                    }}
                    cancelDate={cancelDate}
                    activePlanId={activePlanId}
                    changePlan={changePlan}
                    checkout={checkout}
                    onChangePlanClick={onChangePlanClick}
                    onCheckout={onCheckout}
                  />
                )}

                {selectedProPlan && (
                  <PlanCard
                    plan={selectedProPlan}
                    monthlyPlan={proMonthly}
                    interval={interval}
                    status={{
                      isCurrent: selectedProPlan.id === activePlanId && isSubscribed,
                      hasActiveSubscription,
                      isLoadingEstimate: pendingPlanId === selectedProPlan.id && isEstimateLoading,
                      isOnTeamPlan,
                    }}
                    cancelDate={cancelDate}
                    activePlanId={activePlanId}
                    changePlan={changePlan}
                    checkout={checkout}
                    onChangePlanClick={onChangePlanClick}
                    onCheckout={onCheckout}
                  />
                )}
              </div>
            </div>

            <Card
              className={cn(
                "border-border/80",
                isOnTeamPlan && "border-foreground ring-1 ring-foreground/10",
              )}
            >
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-muted-foreground" />
                    <CardTitle className="text-sm font-medium">{t("Teams")}</CardTitle>
                    {isOnTeamPlan && (
                      <Badge variant="secondary" className="text-xs">
                        {t("Current plan")}
                      </Badge>
                    )}
                  </div>
                  <CardDescription>
                    {t("Give your whole team Pro access with per-seat pricing.")}
                  </CardDescription>
                </div>
                <Button size="sm" render={<Link href="/settings/team" />} nativeButton={false}>
                  {t("Manage Team")}
                </Button>
              </CardHeader>
              <CardContent>
                <PlanHighlights items={teamHighlights} />
              </CardContent>
            </Card>
          </>
        )}
      </PageSectionContent>
    </PageSection>
  );
}
