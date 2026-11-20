import type { LanguageModel } from "ai";
import { env } from "@/env";
import {
  isGuestModel,
  isModelAllowedForAccount,
  isProOnlyModel,
  isProModeAllowedForAccount,
  models,
  resolveReasoningEffort,
} from "@deniai/ai/models";
import {
  createCatalogLanguageModel,
  getCatalogModelProviderId,
  isCatalogProviderUnavailableError,
  type CatalogLanguageModel,
  type CatalogProviderOptions,
} from "@deniai/ai/provider";
import { isModelProviderAvailable } from "@/lib/platform-capabilities";
import { platformCapabilities } from "@/lib/platform-capabilities.server";
import {
  getUsageSummary,
  SHARED_USAGE_CATEGORY,
  type UsageCategory,
  UsageLimitError,
} from "@/lib/usage";
import { capGuestReasoningEffort } from "./usage-estimate";

export class ChatRouteError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "Chat route error");
    this.status = status;
    this.body = body;
  }
}

type ResolveChatModelContextParams = {
  userId: string;
  isAnonymous: boolean;
  baseModel: string;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  /** OpenAI Pro model mode. No catalog model offers it on the Deni AI API yet. */
  proMode?: boolean;
  /** OpenAI Fast mode. No catalog model offers it on the Deni AI API yet. */
  fastMode?: boolean;
};

type ChatProviderOptions = CatalogProviderOptions;

type ResolvedChatModelContext = {
  model: LanguageModel;
  usageCategory: UsageCategory;
  providerOptions: ChatProviderOptions;
};

export async function resolveChatModelContext({
  userId,
  isAnonymous,
  baseModel,
  reasoningEffort,
  proMode = false,
  fastMode = false,
}: ResolveChatModelContextParams): Promise<ResolvedChatModelContext> {
  const selectedModel = models.find((model) => model.value === baseModel);

  if (!selectedModel) {
    throw new ChatRouteError(400, { error: "Unknown model" });
  }

  if (isAnonymous && !isGuestModel(selectedModel.value)) {
    throw new ChatRouteError(403, {
      error: "Only Claude Haiku 5.5 is available for guest sessions.",
    });
  }

  const providerId = getCatalogModelProviderId(selectedModel);
  const deniApiKey = env.DENI_API_KEY?.trim();
  const deniApiBaseUrl = env.DENI_API_BASE_URL;

  if (!providerId) {
    throw new ChatRouteError(400, { error: "Unknown provider" });
  }

  if (!isModelProviderAvailable(platformCapabilities, providerId)) {
    throw new ChatRouteError(503, {
      error: "This model is not configured in the current environment.",
    });
  }

  // Pro and Fast need a model that offers them; the catalog marks none on the Deni AI API.
  const useProMode = Boolean(proMode && selectedModel.supportsProMode);
  const useFastMode = Boolean(fastMode && selectedModel.supportsFastMode);
  void useFastMode;
  // Usage is not split by model class: every request spends the one shared pool (the
  // model's usage tier and Pro mode scale the amount), recorded on the "basic" row.
  const usageCategory: UsageCategory = SHARED_USAGE_CATEGORY;
  // Guests stay on the guest allowlist; verified free accounts unlock the full catalog.
  // All model requests count toward platform usage.
  try {
    const usageSummary = await getUsageSummary({ userId, isAnonymous });

    if (
      !isAnonymous &&
      !isModelAllowedForAccount(
        selectedModel.value,
        usageSummary.tier,
        usageSummary.hasVerifiedPaymentMethod,
      )
    ) {
      throw new ChatRouteError(403, {
        error: isProOnlyModel(selectedModel.value)
          ? "This model is available on the Pro plan. Upgrade to Pro to use it."
          : "This model is not available on your plan. Upgrade to Plus or higher to use it.",
      });
    }

    if (!isAnonymous && useProMode && !isProModeAllowedForAccount(usageSummary.tier)) {
      throw new ChatRouteError(403, {
        error: "Pro mode is not available on your plan. Upgrade to Plus or higher to use it.",
      });
    }

    if (isAnonymous && useProMode) {
      throw new ChatRouteError(403, { error: "Pro mode is not available for guest sessions." });
    }

    const categoryUsage = usageSummary.usage.find((usage) => usage.category === usageCategory);
    const isLimitReached =
      categoryUsage?.remaining !== null &&
      categoryUsage?.remaining !== undefined &&
      categoryUsage.remaining <= 0;

    if (isLimitReached && !usageSummary.maxModeEnabled) {
      throw new UsageLimitError(
        "You've hit the usage limit for your plan.",
        usageSummary.maxModeEligible,
      );
    }
  } catch (error) {
    if (error instanceof ChatRouteError) {
      throw error;
    }
    if (error instanceof UsageLimitError) {
      throw new ChatRouteError(402, {
        error: error.message,
        reason: "usage_limit",
      });
    }

    console.error("Failed to check usage", error);
    throw new ChatRouteError(500, { error: "Unable to check usage" });
  }

  // Resolve against the model first, then cap: an unsupported request (such as
  // "minimal") falls back to the model's preferred effort, which may be above
  // the guest limit.
  const supportedReasoningEffort = resolveReasoningEffort(
    selectedModel?.efforts ?? false,
    reasoningEffort,
  );
  const resolvedReasoningEffort =
    isAnonymous && supportedReasoningEffort
      ? capGuestReasoningEffort(selectedModel.efforts, supportedReasoningEffort)
      : supportedReasoningEffort;

  // How a catalog model is called on the Deni AI API (id, reasoning, caching) is shared with Run.
  let resolved: CatalogLanguageModel;
  try {
    resolved = createCatalogLanguageModel({
      model: selectedModel,
      reasoningEffort: resolvedReasoningEffort,
      keys: { deniApiKey, deniApiBaseUrl },
    });
  } catch (error) {
    if (isCatalogProviderUnavailableError(error)) {
      throw new ChatRouteError(503, { error: error.message });
    }
    throw error;
  }
  const { model, providerOptions } = resolved;

  return {
    model,
    usageCategory,
    providerOptions,
  };
}
