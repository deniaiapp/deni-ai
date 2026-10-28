import { useRouter } from "@/lib/navigation";
import { useExtracted } from "use-intl";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { startTransition, useEffect, useState } from "react";
import { toast } from "sonner";
import type { BillingPlanId, ClientPlan, IndividualPlanId } from "@/lib/billing";
import { isIndividualPlanId, isTeamPlan } from "@/lib/billing";
import { trpc } from "@/lib/trpc/react";
import { settingsUsageQueryOptions } from "@/lib/usage-query-options";
import { ACTIVE_STATUSES, getOfferPercentOff, useBillingReceiptCopy } from "./billing-utils";
import type { SubscriptionReceiptData } from "./subscription-receipt-data";

export function useBillingPage() {
  const t = useExtracted();
  const localizeError = useLocalizeError();
  const { push } = useRouter();
  const [changeTarget, setChangeTarget] = useState<ClientPlan | null>(null);
  // null follows the default: yearly while a limited-time offer is running, else monthly.
  const [plusIntervalChoice, setPlusInterval] = useState<"monthly" | "yearly" | null>(null);
  const [proIntervalChoice, setProInterval] = useState<"monthly" | "yearly" | null>(null);
  const [hasAgreed, setHasAgreed] = useState(false);
  const [pendingPlanId, setPendingPlanId] = useState<IndividualPlanId | null>(null);

  const estimateQuery = trpc.billing.estimatePlanChange.useQuery(
    { planId: pendingPlanId ?? "plus_monthly" },
    {
      enabled: Boolean(pendingPlanId),
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  const isChangePlanOpen =
    pendingPlanId !== null &&
    !estimateQuery.isFetching &&
    (estimateQuery.data !== undefined || estimateQuery.error !== null);

  const handleChangePlanClick = (plan: ClientPlan) => {
    setChangeTarget(plan);
    if (isIndividualPlanId(plan.id)) {
      setPendingPlanId(plan.id);
    }
  };

  const createCheckout = trpc.billing.createCheckoutSession.useMutation();

  const handleCheckout = async (planId: IndividualPlanId) => {
    try {
      const result = await createCheckout.mutateAsync({ planId });
      startTransition(() => {
        push(`/settings/billing/checkout/${result.sessionId}`);
      });
    } catch (error) {
      toast.error(localizeError(error, t("Unable to load checkout.")));
    }
  };

  const utils = trpc.useUtils();
  const statusQuery = trpc.billing.status.useQuery(undefined, {
    staleTime: 60_000,
  });
  const plansQuery = trpc.billing.plans.useQuery();
  const usageQuery = trpc.billing.usage.useQuery(undefined, {
    ...settingsUsageQueryOptions,
  });

  const portal = trpc.billing.createPortalSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      toast.error(t("Stripe did not return a billing portal URL."));
    },
    onError: (error) => toast.error(localizeError(error)),
  });

  const changePlan = trpc.billing.changePlan.useMutation({
    onSuccess: async () => {
      toast.success(t("Plan updated."));
      await utils.billing.status.invalidate();
      await utils.billing.maxModeStatus.invalidate();
      await utils.billing.usage.invalidate();
    },
    onError: (error) => toast.error(localizeError(error)),
    onSettled: () => {
      setChangeTarget(null);
      setPendingPlanId(null);
      setHasAgreed(false);
    },
  });

  const handleDialogOpenChange = (open: boolean) => {
    if (changePlan.isPending) return;
    if (!open) {
      setHasAgreed(false);
      setPendingPlanId(null);
      setChangeTarget(null);
    }
  };

  const handleConfirmChangePlan = (planId: IndividualPlanId) => {
    changePlan.mutate({ planId });
  };

  const [shredOpen, setShredOpen] = useState(false);
  const getReceiptCopy = useBillingReceiptCopy();

  const cancel = trpc.billing.cancelSubscription.useMutation({
    onSuccess: async () => {
      await utils.billing.status.invalidate();
      await utils.billing.maxModeStatus.invalidate();
      await utils.billing.usage.invalidate();
    },
  });

  const resume = trpc.billing.resumeSubscription.useMutation({
    onSuccess: async () => {
      toast.success(t("Subscription resumed."));
      await utils.billing.status.invalidate();
      await utils.billing.maxModeStatus.invalidate();
      await utils.billing.usage.invalidate();
    },
    onError: (error) => toast.error(localizeError(error)),
  });

  const maxModeQuery = trpc.billing.maxModeStatus.useQuery(undefined, {
    staleTime: 60_000,
  });

  const enableMaxMode = trpc.billing.enableMaxMode.useMutation({
    onSuccess: async () => {
      toast.success(t("Max Mode enabled."));
      await utils.billing.maxModeStatus.invalidate();
      await utils.billing.usage.invalidate();
    },
    onError: (error) => toast.error(localizeError(error)),
  });

  const disableMaxMode = trpc.billing.disableMaxMode.useMutation({
    onSuccess: async () => {
      toast.success(t("Max Mode disabled."));
      await utils.billing.maxModeStatus.invalidate();
      await utils.billing.usage.invalidate();
    },
    onError: (error) => toast.error(localizeError(error)),
  });

  const buyMaxModeCredits = trpc.billing.createMaxModeCreditCheckout.useMutation({
    // Stripe-hosted checkout returns to this page with ?credits=success.
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => toast.error(localizeError(error)),
  });

  const updateMaxModeAutoTopUp = trpc.billing.updateMaxModeAutoTopUp.useMutation({
    onSuccess: async () => {
      toast.success(t("Auto top-up settings saved."));
      await utils.billing.maxModeStatus.invalidate();
    },
    onError: (error) => toast.error(localizeError(error)),
  });

  // Back from a paid credit checkout: the webhook may still be granting the credits.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("credits") !== "success") return;
    toast.success(t("Credits purchased. They appear here once the payment is confirmed."));
    url.searchParams.delete("credits");
    window.history.replaceState(window.history.state, "", url);
    const timeout = setTimeout(() => {
      void utils.billing.maxModeStatus.invalidate();
      void utils.billing.usage.invalidate();
    }, 3_000);
    return () => clearTimeout(timeout);
  }, [t, utils]);

  const handleMaxModeToggle = (enabled: boolean) => {
    if (enabled) {
      if (!maxModeQuery.data?.eligible) return;
      enableMaxMode.mutate();
    } else {
      disableMaxMode.mutate();
    }
  };

  const statusLabel = statusQuery.data?.status ?? "inactive";
  const rawPlanId = (statusQuery.data?.planId as BillingPlanId) ?? undefined;
  const currentPeriodEnd = statusQuery.data?.currentPeriodEnd;
  const isSubscribed =
    ACTIVE_STATUSES.has(statusLabel) ||
    (statusLabel === "canceled" &&
      currentPeriodEnd != null &&
      new Date(currentPeriodEnd).getTime() > Date.now());
  const activePlanId = isSubscribed ? rawPlanId : undefined;
  const isOnTeamPlan =
    statusQuery.data?.isTeamPlan === true && rawPlanId ? isTeamPlan(rawPlanId) : false;
  const usage = usageQuery.data?.usage ?? [];
  const usageTier = usageQuery.data?.tier ?? "free";
  const usageTierLabel = (() => {
    switch (usageTier) {
      case "go":
        return t("Go");
      case "plus":
        return t("Plus");
      case "pro":
        return t("Pro");
      default:
        return t("Free");
    }
  })();

  const planMap = new Map((plansQuery.data?.plans ?? []).map((plan) => [plan.id, plan]));
  const currentPlan = activePlanId ? planMap.get(activePlanId) : undefined;
  const isSubscription = statusQuery.data?.mode === "subscription";
  const hasActiveSubscription = isSubscribed && isSubscription;
  const cancelAt = statusQuery.data?.cancelAt;
  const cancelDate = typeof cancelAt === "number" && isSubscription ? cancelAt : null;

  const loading = statusQuery.isLoading || plansQuery.isLoading;
  const errored = statusQuery.error ?? plansQuery.error;
  const allPlans = plansQuery.data?.plans ?? [];

  const goMonthly = allPlans.find((p) => p.id === "go_monthly");
  const plusMonthly = allPlans.find((p) => p.id === "plus_monthly");
  const plusYearly = allPlans.find((p) => p.id === "plus_yearly");
  const proMonthly = allPlans.find((p) => p.id === "pro_monthly");
  const proYearly = allPlans.find((p) => p.id === "pro_yearly");

  const offerPercents = allPlans.map(getOfferPercentOff).filter((percent) => percent > 0);
  const flashOfferLimit = allPlans.find((p) => getOfferPercentOff(p) > 0)?.limitedTimeOffer;
  const flashOfferEndsAt = flashOfferLimit?.kind === "timer" ? flashOfferLimit.endsAt : null;
  const flashOffer =
    flashOfferLimit && !isOnTeamPlan && !hasActiveSubscription
      ? {
          limit: flashOfferLimit,
          percentOff: Math.max(...offerPercents),
          isUpTo: Math.min(...offerPercents) !== Math.max(...offerPercents),
        }
      : null;

  // Refetch when the offer expires so cards drop back to regular prices.
  useEffect(() => {
    if (!flashOfferEndsAt) return;
    const timeout = setTimeout(
      () => void utils.billing.plans.invalidate(),
      Math.max(0, new Date(flashOfferEndsAt).getTime() - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [flashOfferEndsAt, utils]);

  const defaultInterval = flashOffer ? "yearly" : "monthly";
  const plusInterval = plusIntervalChoice ?? defaultInterval;
  const proInterval = proIntervalChoice ?? defaultInterval;
  const showYearlyPlans = () => {
    setPlusInterval("yearly");
    setProInterval("yearly");
  };

  const selectedPlusPlan = plusInterval === "monthly" ? plusMonthly : plusYearly;
  const selectedProPlan = proInterval === "monthly" ? proMonthly : proYearly;
  // One shared pool: the summary has a single usage entry.
  const usageItem = usage[0];
  const cancelReceipt = {
    sessionId: statusQuery.data?.stripeCustomerId ?? activePlanId ?? "cancel",
    ...getReceiptCopy(activePlanId, "/settings/billing", t("Home")),
    amountTotal: currentPlan?.amount ?? 0,
    amountSubtotal: currentPlan?.amount ?? null,
    amountTax: null,
    amountDiscount: null,
    currency: currentPlan?.currency ?? "usd",
    paymentMethodBrand: null,
    paymentMethodLast4: null,
    paidAt: statusQuery.data?.currentPeriodEnd ?? null,
  } satisfies SubscriptionReceiptData;

  return {
    activePlanId,
    usageItem,
    cancel,
    cancelDate,
    cancelReceipt,
    changePlan,
    changeTarget,
    createCheckout,
    currentPlan,
    disableMaxMode,
    enableMaxMode,
    estimateQuery,
    errored,
    flashOffer,
    handleChangePlanClick,
    handleCheckout,
    handleConfirmChangePlan,
    handleDialogOpenChange,
    handleMaxModeToggle,
    hasActiveSubscription,
    hasAgreed,
    isChangePlanOpen,
    isOnTeamPlan,
    isSubscribed,
    goMonthly,
    loading,
    maxModeQuery,
    buyMaxModeCredits,
    updateMaxModeAutoTopUp,
    pendingPlanId,
    plusInterval,
    plusMonthly,
    portal,
    proInterval,
    proMonthly,
    rawPlanId,
    resume,
    selectedPlusPlan,
    selectedProPlan,
    setHasAgreed,
    setPlusInterval,
    setProInterval,
    setShredOpen,
    showYearlyPlans,
    shredOpen,
    statusQuery,
    usageQuery,
    usageTier,
    usageTierLabel,
  };
}
