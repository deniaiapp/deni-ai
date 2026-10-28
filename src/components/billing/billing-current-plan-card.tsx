import { Link } from "@/lib/navigation";
import { useExtracted, useLocale } from "use-intl";
import { useState } from "react";
import type { BillingPlanId, ClientPlan } from "@/lib/billing";
import { formatAppDate } from "@/lib/format-date";
import { usePlanIntervalLabel, useTierLabel } from "./billing-utils";
import { SubscriptionCancelDialog } from "./subscription-shredder";
import { Button } from "../ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Spinner } from "../ui/spinner";

export function BillingCurrentPlanCard({
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
}: {
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
  onCancel: () => void;
  onResume: () => void;
}) {
  const t = useExtracted();
  const locale = useLocale();
  const getTierLabel = useTierLabel();
  const getPlanIntervalLabel = usePlanIntervalLabel();
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-sm font-medium">{t("Current Plan")}</CardTitle>
          <CardDescription>
            {isOnTeamPlan
              ? t("Pro for Teams {name}", {
                  name: rawPlanId ? getPlanIntervalLabel(rawPlanId) : "",
                })
              : currentPlan
                ? t("{tier} {name}", {
                    tier: activePlanId ? getTierLabel(activePlanId) : t("Plus"),
                    name: getPlanIntervalLabel(currentPlan.id),
                  })
                : t("Free")}{" "}
            {cancelDate && (
              <span className="text-destructive">
                {t("(Cancels {date})", {
                  date: formatAppDate(cancelDate * 1000, locale, {
                    month: "short",
                    day: "numeric",
                  }),
                })}
              </span>
            )}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {currentPeriodEnd && !cancelDate && (
            <span className="text-xs text-muted-foreground px-3 py-1 rounded-full bg-muted">
              {t("Renews {date}", {
                date: formatAppDate(currentPeriodEnd, locale, {
                  month: "short",
                  day: "numeric",
                }),
              })}
            </span>
          )}
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
