import type { ReactNode } from "react";
import { useExtracted } from "use-intl";

import { getPlanTier, type BillingPlanId } from "@/lib/billing";
import { USAGE_POOL_USD } from "@/lib/usage-pool";

export type BillingPlanCopy = {
  tagline: string;
  highlights: ReactNode[];
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

/** Key phrases inside a highlight, drawn at full contrast. */
const b = (chunks: ReactNode) => (
  <strong className="font-semibold text-foreground">{chunks}</strong>
);

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
    tier === "pro" || tier === "team"
      ? [t.rich("<b>Compare two models</b> side by side", { b })]
      : [];
  // One monthly pool covers Deni AI chat, Flixa, and Deni Run on every plan.
  const runHighlight = t.rich(
    "One usage pool for <b>Deni AI chat</b>, <b>Flixa</b>, and <b>Deni Run</b>",
    { b },
  );

  switch (planId) {
    case "plus_monthly":
      return {
        tagline: t("Get unbelievable usage limits"),
        highlights: [
          runHighlight,
          t.rich("<b>{multiplier}× more</b> monthly usage than {plan}", {
            b,
            multiplier: String(PLAN_USAGE_MULTIPLIERS.plus.pool),
            plan: PLAN_USAGE_MULTIPLIERS.plus.vs,
          }),
          t.rich("<b>No ads</b> experience", { b }),
          t.rich("Get <b>more models</b> in Deni AI Flixa", { b }),
          t.rich("<b>For trying</b> Deni AI", { b }),
        ],
      };
    case "plus_yearly":
      return {
        tagline: t("Incredible deal"),
        highlights: [
          runHighlight,
          t.rich("<b>{multiplier}× more</b> monthly usage than {plan}", {
            b,
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
          t.rich("<b>{multiplier}× more</b> monthly usage than {plan}", {
            b,
            multiplier: String(PLAN_USAGE_MULTIPLIERS.pro.pool),
            plan: PLAN_USAGE_MULTIPLIERS.pro.vs,
          }),
          ...comparisonHighlights,
          t.rich("Max Mode <b>pay-per-use</b> available", { b }),
          t.rich("For <b>power users</b>", { b }),
        ],
      };
    case "pro_yearly":
      return {
        tagline: t("You like us, and we like you too!"),
        highlights: [
          runHighlight,
          t("Includes all Plus features"),
          t.rich("<b>{multiplier}× more</b> monthly usage than {plan}", {
            b,
            multiplier: String(PLAN_USAGE_MULTIPLIERS.pro.pool),
            plan: PLAN_USAGE_MULTIPLIERS.pro.vs,
          }),
          ...comparisonHighlights,
          t.rich("Max Mode <b>pay-per-use</b> available", { b }),
          t.rich("For <b>power users</b>", { b }),
        ],
      };
    case "max_monthly":
      return {
        tagline: t("Get unbelievable usage limits"),
        highlights: [
          runHighlight,
          t("Includes all Pro features"),
          t.rich("About <b>{multiplier}× more</b> monthly usage than {plan}", {
            b,
            multiplier: String(PLAN_USAGE_MULTIPLIERS.max.pool),
            plan: PLAN_USAGE_MULTIPLIERS.max.vs,
          }),
          ...comparisonHighlights,
          t.rich("For <b>power users</b>", { b }),
        ],
      };
    case "max_yearly":
      return {
        tagline: t("Incredible deal"),
        badge: t("Most cost-effective"),
        highlights: [
          runHighlight,
          t("Includes all Pro features"),
          t.rich("About <b>{multiplier}× more</b> monthly usage than {plan}", {
            b,
            multiplier: String(PLAN_USAGE_MULTIPLIERS.max.pool),
            plan: PLAN_USAGE_MULTIPLIERS.max.vs,
          }),
          ...comparisonHighlights,
          t.rich("For <b>power users</b>", { b }),
        ],
      };
    case "pro_lifetime":
      return {
        tagline: t("One payment. Long-term Pro access."),
        badge: t("Buy once"),
        highlights: [
          runHighlight,
          t("Includes all Plus features"),
          t.rich("<b>{multiplier}× more</b> monthly usage than {plan}", {
            b,
            multiplier: String(PLAN_USAGE_MULTIPLIERS.pro.pool),
            plan: PLAN_USAGE_MULTIPLIERS.pro.vs,
          }),
          ...comparisonHighlights,
          t.rich("Max Mode <b>pay-per-use</b> available", { b }),
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
          t.rich("<b>{multiplier}× more</b> monthly usage than {plan}", {
            b,
            multiplier: String(PLAN_USAGE_MULTIPLIERS.pro.pool),
            plan: PLAN_USAGE_MULTIPLIERS.pro.vs,
          }),
          t.rich("Max Mode <b>pay-per-use</b> available", { b }),
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
          t.rich("<b>{multiplier}× more</b> monthly usage than {plan}", {
            b,
            multiplier: String(PLAN_USAGE_MULTIPLIERS.pro.pool),
            plan: PLAN_USAGE_MULTIPLIERS.pro.vs,
          }),
          t.rich("Max Mode <b>pay-per-use</b> available", { b }),
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
          t.rich("<b>{multiplier}× more</b> monthly usage than {plan}", {
            b,
            multiplier: String(PLAN_USAGE_MULTIPLIERS.max.pool),
            plan: PLAN_USAGE_MULTIPLIERS.max.vs,
          }),
          t.rich("Max Mode <b>pay-per-use</b> available", { b }),
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
          t.rich("<b>{multiplier}× more</b> monthly usage than {plan}", {
            b,
            multiplier: String(PLAN_USAGE_MULTIPLIERS.max.pool),
            plan: PLAN_USAGE_MULTIPLIERS.max.vs,
          }),
          t.rich("Max Mode <b>pay-per-use</b> available", { b }),
          t("Per-seat billing — pay only for active members"),
          t("Centralized billing and member management"),
        ],
      };
    default:
      return null;
  }
}
