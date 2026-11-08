import { useExtracted } from "use-intl";
import { useFormatCurrencyMinor, usePlanIntervalLabel } from "@/components/billing/billing-utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { TeamPlanId } from "@/lib/billing";

export function TeamChangePlanDialog({
  open,
  onOpenChange,
  planId,
  seatCount,
  estimate,
  hasAgreed,
  onHasAgreedChange,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: TeamPlanId | null;
  seatCount: number;
  estimate: {
    error: { message: string } | null;
    data?: { amountDue: number; currency: string | null } | null;
  };
  hasAgreed: boolean;
  onHasAgreedChange: (value: boolean) => void;
  isPending: boolean;
  onConfirm: () => void;
}) {
  const t = useExtracted();
  const getPlanIntervalLabel = usePlanIntervalLabel();
  const formatCurrencyMinor = useFormatCurrencyMinor();
  const intervalLabel = planId ? getPlanIntervalLabel(planId) : "";
  const planLabel = t("Pro for Teams {name}", { name: intervalLabel });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Change team plan?")}</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            <p>
              {t(
                "The team will switch to {plan} for {count, plural, one {# seat} other {# seats}}. The prorated difference is charged to the team's payment method right away.",
                { plan: planLabel, count: seatCount },
              )}
            </p>
            {estimate.error ? (
              <span className="block mt-2">{t("Unable to fetch estimate.")}</span>
            ) : (
              <span className="block mt-2 font-medium text-foreground">
                {t("Estimated charge: {amount}", {
                  amount: formatCurrencyMinor(
                    estimate.data?.amountDue ?? 0,
                    estimate.data?.currency,
                  ),
                })}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-start gap-x-2 py-4">
          <Checkbox
            id="agree-team-plan-change"
            checked={hasAgreed}
            onCheckedChange={(checked) => onHasAgreedChange(checked === true)}
            disabled={estimate.error != null}
          />
          <Label htmlFor="agree-team-plan-change" className="text-sm leading-tight cursor-pointer">
            {t("I have reviewed the estimated charge and agree to the plan change.")}
          </Label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending || !planId || estimate.error != null || !hasAgreed}
            onClick={onConfirm}
          >
            {isPending && <Spinner />}
            {t("Confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
