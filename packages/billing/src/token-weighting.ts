/**
 * Cost-weighted token accounting shared by Deni AI chat and Flixa.
 *
 * Raw token counts treat cache reads, cache writes, input and output as equal,
 * but provider prices differ (cache read ~0.1x input, cache write ~1.25x,
 * output ~5x). Quota usage applies these weights so it tracks real cost:
 *
 * weighted = ceil(
 *   input        x FLIXA_USAGE_WEIGHT_INPUT       (default 1)
 * + cache_read   x FLIXA_USAGE_WEIGHT_CACHE_READ  (default 0.1)
 * + cache_write  x FLIXA_USAGE_WEIGHT_CACHE_WRITE (default 1.25)
 * + output       x FLIXA_USAGE_WEIGHT_OUTPUT      (default 5)
 * )
 *
 * Callers multiply the result by the model's usage tier multiplier.
 */

export type TokenUsageBreakdown = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};

export type TokenUsageWeights = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};

export const DEFAULT_TOKEN_USAGE_WEIGHTS: Readonly<TokenUsageWeights> = {
  input: 1,
  cacheRead: 0.1,
  cacheWrite: 1.25,
  output: 5,
};

/** Environment variable that overrides each weight. */
export const TOKEN_USAGE_WEIGHT_ENV = {
  input: "FLIXA_USAGE_WEIGHT_INPUT",
  cacheRead: "FLIXA_USAGE_WEIGHT_CACHE_READ",
  cacheWrite: "FLIXA_USAGE_WEIGHT_CACHE_WRITE",
  output: "FLIXA_USAGE_WEIGHT_OUTPUT",
} as const;

export type TokenUsageWeightEnv = Partial<
  Record<(typeof TOKEN_USAGE_WEIGHT_ENV)[keyof typeof TOKEN_USAGE_WEIGHT_ENV], string | undefined>
>;

/**
 * Parses one weight override. Empty or missing values, and invalid, negative or
 * non-finite numbers, use the fallback; `parseFloat` semantics are kept
 * (numeric prefixes such as `"2x"` parse as 2, and zero is allowed).
 */
export function parseTokenUsageWeight(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Reads the four weight overrides from an env-like object (e.g. `process.env`). */
export function resolveTokenUsageWeights(env: TokenUsageWeightEnv): TokenUsageWeights {
  return {
    input: parseTokenUsageWeight(
      env[TOKEN_USAGE_WEIGHT_ENV.input],
      DEFAULT_TOKEN_USAGE_WEIGHTS.input,
    ),
    cacheRead: parseTokenUsageWeight(
      env[TOKEN_USAGE_WEIGHT_ENV.cacheRead],
      DEFAULT_TOKEN_USAGE_WEIGHTS.cacheRead,
    ),
    cacheWrite: parseTokenUsageWeight(
      env[TOKEN_USAGE_WEIGHT_ENV.cacheWrite],
      DEFAULT_TOKEN_USAGE_WEIGHTS.cacheWrite,
    ),
    output: parseTokenUsageWeight(
      env[TOKEN_USAGE_WEIGHT_ENV.output],
      DEFAULT_TOKEN_USAGE_WEIGHTS.output,
    ),
  };
}

/** Weighted token count of a breakdown, rounded up. */
export function computeWeightedTokens(
  breakdown: TokenUsageBreakdown,
  weights: TokenUsageWeights,
): number {
  return Math.ceil(
    breakdown.input * weights.input +
      breakdown.cacheRead * weights.cacheRead +
      breakdown.cacheWrite * weights.cacheWrite +
      breakdown.output * weights.output,
  );
}
