/**
 * Usage tiers and the quota multiplier of each. Deni AI chat
 * (deni-ai src/lib/constants.ts USAGE_TIER_MULTIPLIERS) uses the same ladder;
 * keep them in sync.
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

/**
 * Older clients get a `premium` flag for this tier and above. Usage itself is no
 * longer split into basic and premium.
 */
export const PREMIUM_USAGE_TIER = 5;

export function getUsageTierMultiplier(tier: UsageTier): number {
  return USAGE_TIER_MULTIPLIERS[tier];
}

export function isPremiumUsageTier(tier: UsageTier | undefined): boolean {
  return (tier ?? 1) >= PREMIUM_USAGE_TIER;
}
