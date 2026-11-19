import { useExtracted, useLocale } from "use-intl";
import type { ClientPlan, IndividualPlanId } from "@/lib/billing";
import { formatAppDate } from "@/lib/format-date";
import { useFormatCurrencyMinor, usePlanIntervalLabel, useTierLabel } from "./billing-utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@deniai/ui/components/alert-dialog";
import { Checkbox } from "@deniai/ui/components/checkbox";
import { Label } from "@deniai/ui/components/label";
import { Spinner } from "@deniai/ui/components/spinner";

export function BillingChangePlanDialog({
  open,
  onOpenChange,
  changeTarget,
  estimate,
  hasAgreed,
  onHasAgreedChange,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changeTarget: ClientPlan | null;
  estimate: {
    error: { message: string } | null;
    data?: {
      /** An upgrade applies today; a downgrade waits for the end of the paid period. */
      kind?: "upgrade" | "downgrade" | "none";
      amountDue?: number;
      currency?: string | null;
      effectiveAt?: Date | string | null;
    } | null;
  };
  hasAgreed: boolean;
  onHasAgreedChange: (value: boolean) => void;
  isPending: boolean;
  onConfirm: (planId: IndividualPlanId) => void;
}) {
  const t = useExtracted();
  const locale = useLocale();
  const getPlanIntervalLabel = usePlanIntervalLabel();
  const getTierLabel = useTierLabel();
  const formatCurrencyMinor = useFormatCurrencyMinor();
  const plan = changeTarget
    ? t("{tier} {name}", {
        tier: getTierLabel(changeTarget.id),
        name: getPlanIntervalLabel(changeTarget.id),
      })
    : "";
  const isDowngrade = estimate.data?.kind === "downgrade";
  const effectiveDate = estimate.data?.effectiveAt
    ? formatAppDate(estimate.data.effectiveAt, locale, { month: "short", day: "numeric" })
    : "";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Change plan?")}</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            <p>
              {isDowngrade
                ? t(
                    "You will switch to {plan} on {date}, when your current billing period ends. Until then you keep your current plan and its usage. Nothing is charged today.",
                    { plan, date: effectiveDate },
                  )
                : t(
                    "You will switch to {plan} today. A new billing period starts now: you pay the full price of {plan}, less a credit for the unused time on your current plan, and your usage starts over.",
                    { plan },
                  )}
            </p>
            {estimate.error ? (
              <span className="block mt-2">{t("Unable to fetch estimate.")}</span>
            ) : isDowngrade ? null : (
              <span className="block mt-2">
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
            id="agree-plan-change"
            checked={hasAgreed}
            onCheckedChange={(checked) => onHasAgreedChange(checked === true)}
            disabled={estimate.error != null}
          />
          <Label htmlFor="agree-plan-change" className="text-sm leading-tight cursor-pointer">
            {isDowngrade
              ? t("I agree to the plan change.")
              : t("I have reviewed the estimated charge and agree to the plan change.")}
          </Label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending || !changeTarget || estimate.error != null || !hasAgreed}
            onClick={() => {
              if (!changeTarget) return;
              onConfirm(changeTarget.id as IndividualPlanId);
            }}
          >
            {isPending && <Spinner />}
            {t("Confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
