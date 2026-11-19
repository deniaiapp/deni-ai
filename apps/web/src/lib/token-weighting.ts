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
 * (services/agent-api) through `@deniai/billing`.
 */

import {
  computeWeightedTokens as computeWeightedTokensWith,
  resolveTokenUsageWeights,
  type TokenUsageBreakdown,
  type TokenUsageWeights,
} from "@deniai/billing";
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

function nonNegative(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * AI SDK `LanguageModelUsage` shape: already normalized across providers. Uses
 * the broken-out `inputTokenDetails` when available; otherwise falls back to
 * `inputTokens` as raw input with no cache breakdown.
 */
export function breakdownFromLanguageModelUsage(usage: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  inputTokenDetails?: {
    noCacheTokens?: number | null;
    cacheReadTokens?: number | null;
    cacheWriteTokens?: number | null;
  } | null;
}): TokenUsageBreakdown {
  const details = usage.inputTokenDetails;
  const hasDetails =
    details &&
    (details.noCacheTokens != null ||
      details.cacheReadTokens != null ||
      details.cacheWriteTokens != null);

  if (hasDetails) {
    const cacheRead = nonNegative(details?.cacheReadTokens);
    const cacheWrite = nonNegative(details?.cacheWriteTokens);
    const noCache = details?.noCacheTokens;
    let input = nonNegative(noCache);
    // OpenRouter reports noCache as `prompt - cacheRead`, leaving cache writes
    // inside it. Never count more uncached input than the reported total leaves.
    if (typeof usage.inputTokens === "number" && Number.isFinite(usage.inputTokens)) {
      const uncachedFromTotal = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
      input = noCache == null ? uncachedFromTotal : Math.min(input, uncachedFromTotal);
    }
    return {
      input,
      cacheRead,
      cacheWrite,
      output: nonNegative(usage.outputTokens),
    };
  }

  return {
    input: nonNegative(usage.inputTokens),
    cacheRead: 0,
    cacheWrite: 0,
    output: nonNegative(usage.outputTokens),
  };
}

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
export function computeWeightedUsageFromLanguageModelUsage(usage: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  inputTokenDetails?: {
    noCacheTokens?: number | null;
    cacheReadTokens?: number | null;
    cacheWriteTokens?: number | null;
  } | null;
}): { weighted: number; breakdown: TokenUsageBreakdown | null } {
  const hasAnyDetail =
    usage.inputTokens != null ||
    usage.outputTokens != null ||
    usage.inputTokenDetails?.noCacheTokens != null ||
    usage.inputTokenDetails?.cacheReadTokens != null ||
    usage.inputTokenDetails?.cacheWriteTokens != null;

  if (hasAnyDetail) {
    const breakdown = breakdownFromLanguageModelUsage(usage);
    return { weighted: computeWeightedTokens(breakdown), breakdown };
  }

  return { weighted: nonNegative(usage.totalTokens), breakdown: null };
}
