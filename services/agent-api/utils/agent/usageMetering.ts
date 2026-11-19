/**
 * Cost-weighted token metering.
 *
 * Raw token counts treat cache reads, cache writes, input, and output as
 * equal, but the upstream prices differ wildly (cache read ≈ 0.1x input,
 * cache write ≈ 1.25x, output ≈ 5x input). Metering quota with weights makes
 * a user's quota consumption proportional to what their traffic actually
 * costs us — agent sessions that are 90% cache reads stop burning quota at
 * 10x their real cost.
 *
 * Weights are configurable via env:
 *   FLIXA_USAGE_WEIGHT_INPUT        (default 1)
 *   FLIXA_USAGE_WEIGHT_CACHE_READ   (default 0.1)
 *   FLIXA_USAGE_WEIGHT_CACHE_WRITE  (default 1.25)
 *   FLIXA_USAGE_WEIGHT_OUTPUT       (default 5)
 *
 * Set all weights to 1 to restore plain total-token metering.
 */

import { resolveTokenUsageWeights, type TokenUsageWeights } from "@deniai/billing";

// Defaults and env parsing are shared with Deni AI chat (@deniai/billing). Read
// once at startup.
const USAGE_WEIGHTS: TokenUsageWeights = resolveTokenUsageWeights(process.env);

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pick(
  record: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = num(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function nestedCachedTokens(record: Record<string, unknown>): number | null {
  for (const detailsKey of [
    "prompt_tokens_details",
    "promptTokensDetails",
    "input_tokens_details",
    "inputTokensDetails",
  ]) {
    const details = record[detailsKey];
    if (details && typeof details === "object" && !Array.isArray(details)) {
      const cached = pick(
        details as Record<string, unknown>,
        "cached_tokens",
        "cachedTokens",
      );
      if (cached !== null) return cached;
    }
  }
  return null;
}

/**
 * Compute cost-weighted metered tokens from a provider usage object.
 *
 * Handles both layouts:
 * - Anthropic-style: `input_tokens` EXCLUDES cache tokens, which are reported
 *   separately as `cache_read_input_tokens` / `cache_creation_input_tokens`.
 * - OpenAI-style: `prompt_tokens` / `input_tokens` INCLUDES cached tokens,
 *   reported as a subset in `*_tokens_details.cached_tokens` (flattened to
 *   `cached_tokens` by the stream snapshot merger).
 *
 * Falls back to the unweighted total when no input/output breakdown exists.
 * Returns null when the usage object carries no usable numbers.
 */
export function computeMeteredTokens(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const record = usage as Record<string, unknown>;
  const weights = USAGE_WEIGHTS;

  const promptTokens = pick(
    record,
    "prompt_tokens",
    "promptTokens",
    "input_tokens",
    "inputTokens",
  );
  const completionTokens = pick(
    record,
    "completion_tokens",
    "completionTokens",
    "output_tokens",
    "outputTokens",
  );

  if (promptTokens === null && completionTokens === null) {
    // No breakdown available; fall back to the plain total unweighted.
    return pick(record, "total_tokens", "totalTokens");
  }

  const cacheRead = pick(
    record,
    "cache_read_input_tokens",
    "cacheReadInputTokens",
  );
  const cacheWrite = pick(
    record,
    "cache_creation_input_tokens",
    "cacheCreationInputTokens",
  );

  let weighted = (completionTokens ?? 0) * weights.output;

  if (cacheRead !== null || cacheWrite !== null) {
    // Anthropic-style: prompt/input tokens exclude cache tokens.
    weighted +=
      (promptTokens ?? 0) * weights.input +
      (cacheRead ?? 0) * weights.cacheRead +
      (cacheWrite ?? 0) * weights.cacheWrite;
  } else {
    // OpenAI-style: cached tokens are a subset of prompt tokens.
    const cachedSubset = Math.min(
      pick(record, "cached_tokens", "cachedTokens") ??
        nestedCachedTokens(record) ??
        0,
      promptTokens ?? 0,
    );
    weighted +=
      ((promptTokens ?? 0) - cachedSubset) * weights.input +
      cachedSubset * weights.cacheRead;
  }

  const metered = Math.ceil(weighted);
  return Math.max(0, metered);
}
