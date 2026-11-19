/**
 * Usage tiers and the quota multiplier of each, shared by Deni AI chat and
 * Flixa: each token of a model counts as its tier's multiplier toward the
 * monthly pool.
 */
export const USAGE_TIER_MULTIPLIERS = {
  1: 1,
  2: 1.5,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 8,
  9: 10,
  10: 12,
} as const;

export type UsageTier = keyof typeof USAGE_TIER_MULTIPLIERS;

/** Multiplier of a usage tier; `undefined` means Tier 1 (1x). */
export function getUsageTierMultiplier(tier: UsageTier | undefined): number {
  return tier ? USAGE_TIER_MULTIPLIERS[tier] : 1;
}
