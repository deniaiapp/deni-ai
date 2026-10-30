import type { ReactNode } from "react";
import { useExtracted } from "use-intl";

import { getPlanTier, type BillingPlanId } from "@/lib/billing";
import { USAGE_POOL_USD } from "@/lib/usage-pool";

export type BillingPlanCopy = {
  tagline: string;
  highlights: ReactNode[];
  badge?: string;
};

// Multipliers from the shared monthly pool in src/lib/usage-pool.ts (Free $10,
// Go $30, Plus $100, Pro $200), all against Free so the plans compare directly.
const poolRatio = (tier: keyof typeof USAGE_POOL_USD, vs: keyof typeof USAGE_POOL_USD) =>
  Math.round((USAGE_POOL_USD[tier] / USAGE_POOL_USD[vs]) * 10) / 10;
const PLAN_USAGE_MULTIPLIERS = {
  go: { pool: poolRatio("go", "free"), vs: "Free" as const },
  plus: { pool: poolRatio("plus", "free"), vs: "Free" as const },
  pro: { pool: poolRatio("pro", "free"), vs: "Free" as const },
} as const;

/** Key phrases inside a highlight, drawn at full contrast. */
const b = (chunks: ReactNode) => (
  <strong className="font-semibold text-foreground">{chunks}</strong>
);

/** What Pro for Teams adds, shown on its plan cards and the billing overview. */
export function useTeamPlanHighlights(): ReactNode[] {
  const t = useExtracted();
  return [
    t.rich("One usage pool for <b>Deni AI chat</b>, <b>Flixa</b>, and <b>Deni Run</b>", { b }),
    t.rich("<b>Pro benefits</b> for every team member", { b }),
    t.rich("<b>Per-seat billing</b> — pay only for active members", { b }),
    t.rich("<b>Centralized</b> billing and member management, audit log", { b }),
    t.rich("<b>Team projects</b> shared with every member", { b }),
    t.rich("<b>Team domains</b> so coworkers join with their work email", { b }),
  ];
}

export function useBillingPlanCopy(planId: BillingPlanId): BillingPlanCopy;
export function useBillingPlanCopy(planId: null): null;
export function useBillingPlanCopy(planId: BillingPlanId | null): BillingPlanCopy | null;
export function useBillingPlanCopy(planId: BillingPlanId | null): BillingPlanCopy | null {
  const t = useExtracted();
  const teamHighlights = useTeamPlanHighlights();

  if (!planId) {
    return null;
  }

  // One monthly pool covers Deni AI chat, Flixa, and Deni Run on every plan.
  const runHighlight = t.rich(
    "One usage pool for <b>Deni AI chat</b>, <b>Flixa</b>, and <b>Deni Run</b>",
    { b },
  );
  const moreUsage = (tier: keyof typeof PLAN_USAGE_MULTIPLIERS) =>
    t.rich("<b>{multiplier}× more</b> monthly usage than {plan}", {
      b,
      multiplier: String(PLAN_USAGE_MULTIPLIERS[tier].pool),
      plan: PLAN_USAGE_MULTIPLIERS[tier].vs,
    });

  // Monthly and yearly billing of a plan share its tagline and features; only
  // the team plan's yearly billing adds a badge.
  const highlightsByTier = {
    go: [
      runHighlight,
      t("Includes all Free features"),
      moreUsage("go"),
      t.rich("<b>No ads</b> experience", { b }),
      t.rich("<b>More models</b> than Free", { b }),
      t.rich("<b>Max Mode credits</b> to keep going past the limit", { b }),
    ],
    plus: [
      runHighlight,
      t("Includes all Go features"),
      moreUsage("plus"),
      t.rich("Get <b>more models</b> in Deni AI Flixa", { b }),
      t.rich("Use Deni AI Flixa from <b>any coding agent</b>", { b }),
    ],
    pro: [
      runHighlight,
      t("Includes all Plus features"),
      moreUsage("pro"),
      t.rich("<b>Compare two models</b> side by side", { b }),
    ],
    team: teamHighlights,
  };
  const tier = getPlanTier(planId);
  if (!tier) {
    return null;
  }
  const taglineByTier = {
    go: t("Go beyond Free for just a little"),
    plus: t("Get unbelievable usage limits"),
    pro: t("Great deals even for power users"),
    team: t("Give your whole team Pro-tier access with per-seat pricing."),
  };

  return {
    tagline: taglineByTier[tier],
    highlights: highlightsByTier[tier],
    ...(planId === "pro_team_yearly" ? { badge: t("Most cost-effective") } : {}),
  };
}
