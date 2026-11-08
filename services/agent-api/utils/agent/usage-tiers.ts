import type { UsageTier } from "@deniai/billing";

/**
 * Usage tiers and the quota multiplier of each, shared with Deni AI chat
 * through `@deniai/billing`.
 */
export { getUsageTierMultiplier, USAGE_TIER_MULTIPLIERS, type UsageTier } from "@deniai/billing";

/**
 * Older clients get a `premium` flag for this tier and above. Usage itself is no
 * longer split into basic and premium.
 */
export const PREMIUM_USAGE_TIER = 5;

export function isPremiumUsageTier(tier: UsageTier | undefined): boolean {
  return (tier ?? 1) >= PREMIUM_USAGE_TIER;
}
