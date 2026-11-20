import {
  computeWeightedTokens,
  type TokenUsageBreakdown,
  type TokenUsageWeights,
} from "@deniai/billing";
import { getEffectiveTokenMultiplier, type EffectiveTokenMultiplierOptions } from "./models";

/**
 * What a model request costs in usage units, shared by Deni AI chat and Deni Run:
 * cost-weighted tokens (`@deniai/billing` weights) times the model's usage tier and any
 * request multiplier (Pro, Fast, promotions, OpenAI long context).
 */

/** AI SDK `LanguageModelUsage`, as far as usage accounting reads it. */
export type ModelTokenUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  inputTokenDetails?: {
    noCacheTokens?: number | null;
    cacheReadTokens?: number | null;
    cacheWriteTokens?: number | null;
  } | null;
};

function nonNegative(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * AI SDK `LanguageModelUsage` shape: already normalized across providers. Uses
 * the broken-out `inputTokenDetails` when available; otherwise falls back to
 * `inputTokens` as raw input with no cache breakdown.
 */
export function breakdownFromLanguageModelUsage(
  usage: Omit<ModelTokenUsage, "totalTokens">,
): TokenUsageBreakdown {
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

/**
 * Prefers the broken-out input/output detail; otherwise falls back to `total_tokens`
 * (un-weighted) to avoid charging zero when a provider returns only the rolled-up count.
 */
export function computeWeightedUsageFromLanguageModelUsage(
  usage: ModelTokenUsage,
  weights: TokenUsageWeights,
): { weighted: number; breakdown: TokenUsageBreakdown | null } {
  const hasAnyDetail =
    usage.inputTokens != null ||
    usage.outputTokens != null ||
    usage.inputTokenDetails?.noCacheTokens != null ||
    usage.inputTokenDetails?.cacheReadTokens != null ||
    usage.inputTokenDetails?.cacheWriteTokens != null;

  if (hasAnyDetail) {
    const breakdown = breakdownFromLanguageModelUsage(usage);
    return { weighted: computeWeightedTokens(breakdown, weights), breakdown };
  }

  return { weighted: nonNegative(usage.totalTokens), breakdown: null };
}

/**
 * Usage units of one model request. Apply this per request before adding steps: the
 * long-context premium reads the request's input, and aggregate input is not a context size.
 */
export function calculateModelUsageAmount(
  modelId: string,
  usage: ModelTokenUsage,
  weights: TokenUsageWeights,
  options?: EffectiveTokenMultiplierOptions,
): number {
  const { weighted, breakdown } = computeWeightedUsageFromLanguageModelUsage(usage, weights);
  const inputTokens = breakdown
    ? breakdown.input + breakdown.cacheRead + breakdown.cacheWrite
    : typeof usage.inputTokens === "number" && Number.isFinite(usage.inputTokens)
      ? Math.max(0, usage.inputTokens)
      : 0;
  return Math.ceil(weighted * getEffectiveTokenMultiplier(modelId, inputTokens, options));
}
