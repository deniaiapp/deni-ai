import type { FlashOfferLimit } from "@/lib/billing-offers";

import {
  type BillingPlanId,
  getPlanTier,
  type IndividualPlanId,
  PLAN_FAMILY_BY_ID,
  type TeamPlanId,
} from "@deniai/billing";

// Plan ids and their tiers are shared with the usage engine (@deniai/billing).
export type { BillingPlanId, IndividualPlanId, TeamPlanId };
export { getPlanTier };

export type BillingPlan = {
  id: BillingPlanId;
  lookupKey: string;
};

export type ClientPlan = {
  id: BillingPlanId;
  lookupKey: string;
  priceId: string | null;
  mode: "subscription" | "payment" | null;
  amount: number | null;
  originalAmount?: number | null;
  currency: string | null;
  interval: string | null;
  intervalCount: number;
  isTeamPlan: boolean;
  limitedTimeOffer?: FlashOfferLimit | null;
};

export const billingPlans: BillingPlan[] = [
  {
    id: "go_monthly",
    lookupKey: "go_monthly",
  },
  {
    id: "plus_monthly",
    lookupKey: "plus_monthly",
  },
  {
    id: "plus_yearly",
    lookupKey: "plus_yearly",
  },
  {
    id: "pro_monthly",
    lookupKey: "pro_monthly",
  },
  {
    id: "pro_yearly",
    lookupKey: "pro_yearly",
  },
  {
    id: "pro_team_monthly",
    lookupKey: "pro_team_monthly",
  },
  {
    id: "pro_team_yearly",
    lookupKey: "pro_team_yearly",
  },
];

const planIdToTier = PLAN_FAMILY_BY_ID;

export function findPlanById(planId: BillingPlanId | string) {
  return billingPlans.find((plan) => plan.id === planId);
}

export function findPlanByLookupKey(lookupKey: string | null | undefined) {
  if (!lookupKey) {
    return undefined;
  }
  return billingPlans.find((plan) => plan.lookupKey === lookupKey);
}

export function isTeamPlanId(planId: string | null | undefined): planId is TeamPlanId {
  return planId != null && planIdToTier.get(planId as BillingPlanId) === "team";
}

export function isIndividualPlanId(planId: string | null | undefined): planId is IndividualPlanId {
  if (planId == null) {
    return false;
  }

  const tier = planIdToTier.get(planId as BillingPlanId);
  return tier != null && tier !== "team";
}

export function isTeamPlan(planId: string | null | undefined): boolean {
  return Boolean(planId?.startsWith("pro_team"));
}
