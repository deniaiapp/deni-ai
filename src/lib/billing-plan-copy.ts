import { useExtracted } from "use-intl";

import { getPlanTier, type BillingPlanId } from "@/lib/billing";
import { USAGE_POOL_USD } from "@/lib/usage-pool";

export type BillingPlanCopy = {
  tagline: string;
  highlights: string[];
  badge?: string;
};

// Multipliers vs. the next-lower tier, from the shared monthly pool in
// src/lib/usage-pool.ts (Free $10, Plus $100, Pro $200, Max $300). Ratios against
// the adjacent tier keep the copy meaningful and make upgrade value tangible.
const poolRatio = (tier: keyof typeof USAGE_POOL_USD, vs: keyof typeof USAGE_POOL_USD) =>
  Math.round((USAGE_POOL_USD[tier] / USAGE_POOL_USD[vs]) * 10) / 10;
const PLAN_USAGE_MULTIPLIERS = {
  plus: { pool: poolRatio("plus", "free"), vs: "Free" as const },
  pro: { pool: poolRatio("pro", "plus"), vs: "Plus" as const },
  max: { pool: poolRatio("max", "pro"), vs: "Pro" as const },
} as const;

export function useBillingPlanCopy(planId: BillingPlanId): BillingPlanCopy;
export function useBillingPlanCopy(planId: null): null;
export function useBillingPlanCopy(planId: BillingPlanId | null): BillingPlanCopy | null;
export function useBillingPlanCopy(planId: BillingPlanId | null): BillingPlanCopy | null {
  const t = useExtracted();

  if (!planId) {
    return null;
  }

  const tier = getPlanTier(planId);
  const comparisonHighlights =
    tier === "pro" || tier === "team" ? [t("Compare two models side by side")] : [];
  // One monthly pool covers Deni AI chat, Flixa, and Deni Run on every plan.
  const runHighlight = t("One usage pool for Deni AI chat, Flixa, and Deni Run");

  switch (planId) {
    case "plus_monthly":
      return {
        tagline: t("Get unbelievable usage limits"),
        highlights: [
          runHighlight,
          t("{multiplier}× more monthly usage than {plan}", {
            multiplier: String(PLAN_USAGE_MULTIPLIERS.plus.pool),
            plan: PLAN_USAGE_MULTIPLIERS.plus.vs,
          }),
          t("No ads experience"),
          t("Get more models in Deni AI Flixa"),
          t("For trying Deni AI"),
        ],
      };
    case "plus_yearly":
      return {
        tagline: t("Incredible deal"),
        highlights: [
          runHighlight,
          t("{multiplier}× more monthly usage than {plan}", {
            multiplier: String(PLAN_USAGE_MULTIPLIERS.plus.pool),
            plan: PLAN_USAGE_MULTIPLIERS.plus.vs,
          }),
          t("With priority support"),
          t("Deni AI Flixa - Plus access"),
          t("Most cost-effective"),
        ],
      };
    case "pro_monthly":
      return {
        tagline: t("Great deals even for power users"),
        highlights: [
          runHighlight,
          t("Includes all Plus features"),
          t("{multiplier}× more monthly usage than {plan}", {
            multiplier: String(PLAN_USAGE_MULTIPLIERS.pro.pool),
            plan: PLAN_USAGE_MULTIPLIERS.pro.vs,
          }),
          ...comparisonHighlights,
          t("Max Mode pay-per-use available"),
          t("For power users"),
        ],
      };
    case "pro_yearly":
      return {
        tagline: t("You like us, and we like you too!"),
        highlights: [
          runHighlight,
          t("Includes all Plus features"),
          t("{multiplier}× more monthly usage than {plan}", {
            multiplier: String(PLAN_USAGE_MULTIPLIERS.pro.pool),
            plan: PLAN_USAGE_MULTIPLIERS.pro.vs,
          }),
          ...comparisonHighlights,
          t("Max Mode pay-per-use available"),
          t("For power users"),
        ],
      };
    case "max_monthly":
      return {
        tagline: t("Get unbelievable usage limits"),
        highlights: [
          runHighlight,
          t("Includes all Pro features"),
          t("About {multiplier}× more monthly usage than {plan}", {
            multiplier: String(PLAN_USAGE_MULTIPLIERS.max.pool),
            plan: PLAN_USAGE_MULTIPLIERS.max.vs,
          }),
          ...comparisonHighlights,
          t("For power users"),
        ],
      };
    case "max_yearly":
      return {
        tagline: t("Incredible deal"),
        badge: t("Most cost-effective"),
        highlights: [
          runHighlight,
          t("Includes all Pro features"),
          t("About {multiplier}× more monthly usage than {plan}", {
            multiplier: String(PLAN_USAGE_MULTIPLIERS.max.pool),
            plan: PLAN_USAGE_MULTIPLIERS.max.vs,
          }),
          ...comparisonHighlights,
          t("For power users"),
        ],
      };
    case "pro_lifetime":
      return {
        tagline: t("One payment. Long-term Pro access."),
        badge: t("Buy once"),
        highlights: [
          runHighlight,
          t("Includes all Plus features"),
          t("{multiplier}× more monthly usage than {plan}", {
            multiplier: String(PLAN_USAGE_MULTIPLIERS.pro.pool),
            plan: PLAN_USAGE_MULTIPLIERS.pro.vs,
          }),
          ...comparisonHighlights,
          t("Max Mode pay-per-use available"),
          t("No recurring subscription"),
        ],
      };
    case "pro_team_monthly":
      return {
        tagline: t("Give your whole team Pro-tier access with per-seat pricing."),
        highlights: [
          runHighlight,
          ...comparisonHighlights,
          t("Pro benefits for every team member"),
          t("{multiplier}× more monthly usage than {plan}", {
            multiplier: String(PLAN_USAGE_MULTIPLIERS.pro.pool),
            plan: PLAN_USAGE_MULTIPLIERS.pro.vs,
          }),
          t("Max Mode pay-per-use available"),
          t("Per-seat billing — pay only for active members"),
          t("Centralized billing and member management"),
        ],
      };
    case "pro_team_yearly":
      return {
        tagline: t("Give your whole team Pro-tier access with per-seat pricing."),
        badge: t("Most cost-effective"),
        highlights: [
          runHighlight,
          ...comparisonHighlights,
          t("Pro benefits for every team member"),
          t("{multiplier}× more monthly usage than {plan}", {
            multiplier: String(PLAN_USAGE_MULTIPLIERS.pro.pool),
            plan: PLAN_USAGE_MULTIPLIERS.pro.vs,
          }),
          t("Max Mode pay-per-use available"),
          t("Per-seat billing — pay only for active members"),
          t("Centralized billing and member management"),
        ],
      };
    case "max_team_monthly":
      return {
        tagline: t("Give your whole team Max-tier access with per-seat pricing."),
        highlights: [
          runHighlight,
          ...comparisonHighlights,
          t("Max benefits for every team member"),
          t("{multiplier}× more monthly usage than {plan}", {
            multiplier: String(PLAN_USAGE_MULTIPLIERS.max.pool),
            plan: PLAN_USAGE_MULTIPLIERS.max.vs,
          }),
          t("Max Mode pay-per-use available"),
          t("Per-seat billing — pay only for active members"),
          t("Centralized billing and member management"),
        ],
      };
    case "max_team_yearly":
      return {
        tagline: t("Give your whole team Max-tier access with per-seat pricing."),
        badge: t("Most cost-effective"),
        highlights: [
          runHighlight,
          ...comparisonHighlights,
          t("Max benefits for every team member"),
          t("{multiplier}× more monthly usage than {plan}", {
            multiplier: String(PLAN_USAGE_MULTIPLIERS.max.pool),
            plan: PLAN_USAGE_MULTIPLIERS.max.vs,
          }),
          t("Max Mode pay-per-use available"),
          t("Per-seat billing — pay only for active members"),
          t("Centralized billing and member management"),
        ],
      };
    default:
      return null;
  }
}
