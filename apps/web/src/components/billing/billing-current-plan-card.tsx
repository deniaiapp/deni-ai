import { Link } from "@/lib/navigation";
import { useExtracted, useLocale } from "use-intl";
import { useState, type ReactNode } from "react";
import type { BillingPlanId, ClientPlan } from "@/lib/billing";
import type { CancellationFeedback } from "@/lib/cancellation-feedback";
import { formatAppDate } from "@/lib/format-date";
import { usePlanIntervalLabel, useTierLabel } from "./billing-utils";
import { SubscriptionCancelDialog } from "./subscription-cancel-dialog";
import { Button } from "@deniai/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@deniai/ui/components/card";
import { Spinner } from "@deniai/ui/components/spinner";

export function BillingCurrentPlanCard({
  isEducation,
  isOnTeamPlan,
  rawPlanId,
  currentPlan,
  activePlanId,
  cancelDate,
  currentPeriodEnd,
  stripeCustomerId,
  hasActiveSubscription,
  portalPending,
  cancelPending,
  resumePending,
  onPortal,
  onCancel,
  onResume,
  children,
}: {
  isEducation: boolean;
  isOnTeamPlan: boolean;
  rawPlanId: BillingPlanId | undefined;
  currentPlan: ClientPlan | undefined;
  activePlanId: BillingPlanId | undefined;
  cancelDate: number | null;
  currentPeriodEnd?: Date | string | null;
  stripeCustomerId?: string | null;
  hasActiveSubscription: boolean;
  portalPending: boolean;
  cancelPending: boolean;
  resumePending: boolean;
  onPortal: () => void;
  onCancel: (feedback: CancellationFeedback) => void;
  onResume: () => void;
  /** This month's usage, shown under the plan. */
  children?: ReactNode;
}) {
  const t = useExtracted();
  const locale = useLocale();
  const getTierLabel = useTierLabel();
  const getPlanIntervalLabel = usePlanIntervalLabel();
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">{t("Current plan")}</p>
          <CardTitle className="text-xl font-semibold tracking-tight">
            {isOnTeamPlan
              ? t("Pro for Teams {name}", {
                  name: rawPlanId ? getPlanIntervalLabel(rawPlanId) : "",
                })
              : currentPlan
                ? t("{tier} {name}", {
                    tier: activePlanId ? getTierLabel(activePlanId) : t("Plus"),
                    name: getPlanIntervalLabel(currentPlan.id),
                  })
                : isEducation
                  ? t("Go (free for education)")
                  : t("Free")}
          </CardTitle>
          {cancelDate ? (
            <CardDescription className="text-destructive">
              {t("Cancels {date}", {
                date: formatAppDate(cancelDate * 1000, locale, {
                  month: "short",
                  day: "numeric",
                }),
              })}
            </CardDescription>
          ) : currentPeriodEnd ? (
            <CardDescription>
              {t("Renews {date}", {
                date: formatAppDate(currentPeriodEnd, locale, {
                  month: "short",
                  day: "numeric",
                }),
              })}
            </CardDescription>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOnTeamPlan ? (
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/settings/team" />}
              nativeButton={false}
            >
              {t("Manage Team")}
            </Button>
          ) : (
            <>
              {stripeCustomerId && (
                <Button variant="outline" size="sm" disabled={portalPending} onClick={onPortal}>
                  {portalPending && <Spinner className="size-4 mr-1" />}
                  {t("Manage")}
                </Button>
              )}
              {hasActiveSubscription && !cancelDate && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={cancelPending}
                  onClick={() => setIsCancelConfirmOpen(true)}
                >
                  {cancelPending && <Spinner className="size-4 mr-1" />}
                  {t("Cancel subscription")}
                </Button>
              )}
              {cancelDate && (
                <Button size="sm" disabled={resumePending} onClick={onResume}>
                  {resumePending && <Spinner className="size-4 mr-1" />}
                  {t("Resume")}
                </Button>
              )}
            </>
          )}
        </div>
      </CardHeader>
      {children && (
        <CardContent className="border-t border-border pt-(--card-spacing)">{children}</CardContent>
      )}
      <SubscriptionCancelDialog
        open={isCancelConfirmOpen}
        onOpenChange={setIsCancelConfirmOpen}
        description={t(
          "Your plan stays active until the end of the current billing period. You can resume it any time before then.",
        )}
        onConfirm={onCancel}
      />
    </Card>
  );
}
