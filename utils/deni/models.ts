import { getModelDefinition } from '../agent/models';

export type ModelCategory = "basic" | "premium";

// Premium model patterns (high-end models)
const PREMIUM_PATTERNS = [
  // Claude models (matches both claude-3-opus and claude-opus-4-6 formats)
  /claude-.*opus/i,
  /claude-.*sonnet/i,
];

// Models that require a minimum tier to access
// Each entry maps a pattern to the minimum tier required
const TIER_RESTRICTED_MODELS: Array<{
  pattern: RegExp;
  minTier: "plus" | "pro" | "max";
}> = [
  // claude-sonnet-4-5 requires plus or higher
  { pattern: /claude-sonnet-4[.-]5/i, minTier: "plus" },
  { pattern: /anthropic\/claude-sonnet-4[.-]5/i, minTier: "plus" },
  { pattern: /claude-opus-4[.-]6/i, minTier: "plus" },
  { pattern: /anthropic\/claude-opus-4[.-]6/i, minTier: "plus" },
];

/**
 * Determine if a model is premium or basic category
 */
export function getModelCategory(model: string): ModelCategory {
  const definition = getModelDefinition(model);
  if (definition?.premium) {
    return "premium";
  }

  const modelLower = model.toLowerCase();

  for (const pattern of PREMIUM_PATTERNS) {
    if (pattern.test(modelLower)) {
      return "premium";
    }
  }

  return "basic";
}

/**
 * Check if user's tier allows access to a specific model.
 * Returns null if no restriction, or the minimum tier required if restricted.
 */
export function getRequiredTierForModel(model: string): "plus" | "pro" | "max" | null {
  const definition = getModelDefinition(model);
  if (definition && definition.tier !== 'free') {
    return definition.tier;
  }

  for (const { pattern, minTier } of TIER_RESTRICTED_MODELS) {
    if (pattern.test(model)) {
      return minTier;
    }
  }
  // Unlisted models are never free: only registered free-tier models skip this check.
  return definition ? null : "plus";
}

/**
 * Check if a user's tier meets the minimum required tier for a model
 */
const TIER_LEVELS: Record<string, number> = { free: 0, plus: 1, pro: 2, max: 3 };

export function isTierSufficient(
  userTier: "free" | "plus" | "pro" | "max",
  requiredTier: "plus" | "pro" | "max",
): boolean {
  return (TIER_LEVELS[userTier] ?? 0) >= (TIER_LEVELS[requiredTier] ?? 0);
}

/**
 * Check if user has enough quota for the model category
 */
export function hasQuotaForModel(
  usage: Array<{ category: "basic" | "premium"; remaining: number | null }>,
  modelCategory: ModelCategory,
): { allowed: boolean; remaining: number | null } {
  const categoryUsage = usage.find((u) => u.category === modelCategory);

  if (!categoryUsage) {
    return { allowed: true, remaining: null };
  }

  const remaining = categoryUsage.remaining;
  if (remaining === null) {
    return { allowed: true, remaining: null };
  }

  return { allowed: remaining > 0, remaining };
}
