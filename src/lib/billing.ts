import type { FlashOfferLimit } from "@/lib/billing-offers";

export type IndividualPlanId =
  | "go_monthly"
  | "plus_monthly"
  | "plus_yearly"
  | "pro_monthly"
  | "pro_yearly";

export type TeamPlanId = "pro_team_monthly" | "pro_team_yearly";

export type BillingPlanId = IndividualPlanId | TeamPlanId;

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

const planIdToTier = new Map<BillingPlanId, "go" | "plus" | "pro" | "team">([
  ["go_monthly", "go"],
  ["plus_monthly", "plus"],
  ["plus_yearly", "plus"],
  ["pro_monthly", "pro"],
  ["pro_yearly", "pro"],
  ["pro_team_monthly", "team"],
  ["pro_team_yearly", "team"],
]);

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

export function getPlanTier(
  planId: string | null | undefined,
): "go" | "plus" | "pro" | "team" | null {
  if (!planId) {
    return null;
  }

  return planIdToTier.get(planId as BillingPlanId) ?? null;
}

export function isProOrHigherTier(planId: string | null | undefined): boolean {
  const tier = getPlanTier(planId);
  return tier === "pro" || tier === "team";
}
