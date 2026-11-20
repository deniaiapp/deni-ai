/**
 * Cost-weighted token accounting.
 *
 * Quota consumption used to sum raw token counts equally, which dramatically
 * overcharged cache reads (~1/10 actual cost) and undercharged output tokens
 * (~5× actual cost). This helper applies per-component weights so that quota
 * usage tracks real provider cost.
 *
 * weighted = ceil(
 *   input        × FLIXA_USAGE_WEIGHT_INPUT       (default 1)
 * + cache_read   × FLIXA_USAGE_WEIGHT_CACHE_READ  (default 0.1)
 * + cache_write  × FLIXA_USAGE_WEIGHT_CACHE_WRITE (default 1.25)
 * + output       × FLIXA_USAGE_WEIGHT_OUTPUT      (default 5)
 * )
 *
 * Caller multiplies by the model-specific `tokenUsageMultiplier`.
 *
 * The weights, their env overrides and the weighted sum are shared with Flixa
 * (services/agent-api) through `@deniai/billing`; reading a model's usage into the
 * breakdown is shared with Deni Run through `@deniai/ai/usage-amount`.
 */

import {
  computeWeightedTokens as computeWeightedTokensWith,
  resolveTokenUsageWeights,
  type TokenUsageBreakdown,
  type TokenUsageWeights,
} from "@deniai/billing";
import {
  breakdownFromLanguageModelUsage,
  computeWeightedUsageFromLanguageModelUsage as computeWeightedUsageWith,
  type ModelTokenUsage,
} from "@deniai/ai/usage-amount";
import { env } from "@/env";

export type { TokenUsageBreakdown, TokenUsageWeights };

export function getTokenUsageWeights(): TokenUsageWeights {
  return resolveTokenUsageWeights({
    FLIXA_USAGE_WEIGHT_INPUT: env.FLIXA_USAGE_WEIGHT_INPUT,
    FLIXA_USAGE_WEIGHT_CACHE_READ: env.FLIXA_USAGE_WEIGHT_CACHE_READ,
    FLIXA_USAGE_WEIGHT_CACHE_WRITE: env.FLIXA_USAGE_WEIGHT_CACHE_WRITE,
    FLIXA_USAGE_WEIGHT_OUTPUT: env.FLIXA_USAGE_WEIGHT_OUTPUT,
  });
}

export { breakdownFromLanguageModelUsage };

export function computeWeightedTokens(
  breakdown: TokenUsageBreakdown,
  weights: TokenUsageWeights = getTokenUsageWeights(),
): number {
  return computeWeightedTokensWith(breakdown, weights);
}

/**
 * Top-level entry point used by the chat route. Prefers the broken-out
 * input/output detail; otherwise falls back to `total_tokens` (un-weighted) to
 * avoid charging zero when a provider returns only the rolled-up count.
 */
export function computeWeightedUsageFromLanguageModelUsage(usage: ModelTokenUsage): {
  weighted: number;
  breakdown: TokenUsageBreakdown | null;
} {
  return computeWeightedUsageWith(usage, getTokenUsageWeights());
}
