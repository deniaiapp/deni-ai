import { useExtracted } from "use-intl";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { toast } from "sonner";
import type { ModelOption } from "@/components/chat/chat-composer";
import { usePlatformCapabilities } from "@/components/platform-capabilities-provider";
import { trpc } from "@/lib/trpc/react";
import { liveUsageQueryOptions } from "@/lib/usage-query-options";

export function useUsageStatus(params: {
  model: string;
  availableModels: ModelOption[];
  /** Pro mode on a Pro-capable model (its usage is scaled, from the same pool). */
  proMode?: boolean;
}) {
  const t = useExtracted();
  const localizeError = useLocalizeError();
  const { model, availableModels } = params;
  const { features } = usePlatformCapabilities();

  const usageQuery = trpc.billing.usage.useQuery(undefined, {
    ...liveUsageQueryOptions,
  });

  const selectedModel = availableModels.find((m) => m.value === model);
  // One shared pool: the summary's single usage entry is what is left of it.
  const categoryUsage = usageQuery.data?.usage[0];
  const remainingUsage = categoryUsage?.remaining;
  const usageLimit = categoryUsage?.limit;
  const usageTier = usageQuery.data?.tier ?? "free";
  const isSignupLimited = usageQuery.data?.signupLimited ?? false;

  const remainingPercent =
    remainingUsage == null || usageLimit == null || usageLimit <= 0
      ? null
      : Math.max(0, Math.min(100, (remainingUsage / usageLimit) * 100));
  const remaining = remainingUsage;
  const limit = usageLimit;
  const lowUsageThreshold =
    remaining == null || limit == null ? null : Math.max(3, Math.min(20, Math.ceil(limit * 0.1)));

  const maxModeEnabled = features.billing && (usageQuery.data?.maxModeEnabled ?? false);
  const isUsageLow =
    !maxModeEnabled &&
    remainingUsage !== null &&
    remainingUsage !== undefined &&
    usageLimit !== null &&
    usageLimit !== undefined &&
    lowUsageThreshold !== null &&
    remainingUsage > 0 &&
    remainingUsage <= lowUsageThreshold;
  const isUsageBlocked =
    !maxModeEnabled &&
    remainingUsage !== null &&
    remainingUsage !== undefined &&
    remainingUsage <= 0;
  const usageTierLabel =
    usageTier === "free"
      ? t("Free")
      : usageTier === "go"
        ? t("Go")
        : usageTier === "plus"
          ? t("Plus")
          : t("Pro");
  const maxModeEligible = features.billing && (usageQuery.data?.maxModeEligible ?? false);
  const hasMaxModeCredits = (usageQuery.data?.maxModeCredits ?? 0) > 0;
  // Max Mode spends prepaid credits: with none left, the way on is buying some.
  const canEnableMaxMode =
    features.billing && maxModeEligible && !maxModeEnabled && isUsageBlocked && hasMaxModeCredits;
  const needsMaxModeCredits =
    features.billing && maxModeEligible && isUsageBlocked && !hasMaxModeCredits;
  const isSubmitBlocked = !selectedModel || (isUsageBlocked && !maxModeEnabled);

  const utils = trpc.useUtils();
  const enableMaxMode = trpc.billing.enableMaxMode.useMutation({
    onSuccess: async () => {
      toast.success(t("Max Mode enabled."));
      await Promise.all([
        usageQuery.refetch(),
        utils.billing.maxModeStatus.invalidate(),
        utils.billing.usage.invalidate(),
      ]);
    },
    onError: (error) => toast.error(localizeError(error)),
  });

  return {
    usageQuery,
    selectedModel,
    usageTier,
    isSignupLimited,
    isUsageLow,
    isUsageBlocked,
    canEnableMaxMode,
    needsMaxModeCredits,
    isSubmitBlocked,
    usageTierLabel,
    remainingUsage,
    remainingPercent,
    enableMaxMode,
  };
}
