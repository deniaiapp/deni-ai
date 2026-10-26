import type { SubscriptionTier } from "@/lib/usage";

/**
 * One monthly usage pool per plan, shared by Deni AI chat, Flixa, and Deni Run.
 *
 * The pool is priced in USD. Chat and Flixa spend weighted tokens (token
 * weights times the model's usage tier); Deni Run spends its provider cost.
 * Both are counted in usage units: 1M units = $0.50, so a Pro pool of $200
 * is 400M units. flixa-backend (utils/deni/usage.ts) and Deni Run use the same
 * values; keep them in sync.
 */
export const USAGE_POOL_USD: Record<SubscriptionTier, number> = {
  free: 10,
  plus: 100,
  pro: 200,
  max: 300,
};

/** Free accounts with a verified payment method (anti-abuse trust signal). */
export const VERIFIED_FREE_POOL_USD = 15;

/** Free accounts flagged at sign-up as part of a batch, until a card is verified. */
export const FLAGGED_FREE_POOL_USD = 2;

export const USAGE_UNITS_PER_USD = 2_000_000;

/** Deni Run records cost in micro-dollars: 1 micro-dollar = 2 units. */
export const USAGE_UNITS_PER_USD_MICRO = USAGE_UNITS_PER_USD / 1_000_000;

export function usdToUsageUnits(usd: number) {
  return Math.round(usd * USAGE_UNITS_PER_USD);
}

export function usageUnitsToUsd(units: number) {
  return units / USAGE_UNITS_PER_USD;
}
