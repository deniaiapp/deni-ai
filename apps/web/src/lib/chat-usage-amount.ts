import type { EffectiveTokenMultiplierOptions } from "@deniai/ai/models";
import { calculateModelUsageAmount, type ModelTokenUsage } from "@deniai/ai/usage-amount";
import { getTokenUsageWeights } from "@/lib/token-weighting";

type ModelUsage = ModelTokenUsage;

/**
 * Apply request pricing before adding steps; aggregate input is not a context size.
 * The formula is shared with Deni Run (`@deniai/ai/usage-amount`).
 */
export function calculateChatUsageAmount(
  modelId: string,
  usage: ModelUsage,
  options?: EffectiveTokenMultiplierOptions,
): number {
  return calculateModelUsageAmount(modelId, usage, getTokenUsageWeights(), options);
}

/** Providers without step usage can still report their final rolled-up usage. */
export function resolveFinalChatUsageAmount(
  stepAmount: number,
  modelId: string,
  totalUsage: ModelUsage,
  options?: EffectiveTokenMultiplierOptions,
): number {
  return stepAmount === 0 ? calculateChatUsageAmount(modelId, totalUsage, options) : stepAmount;
}
