/** Stripe-backed plan ids of Deni AI (individual and team plans). */
export type IndividualPlanId =
  | "go_monthly"
  | "plus_monthly"
  | "plus_yearly"
  | "pro_monthly"
  | "pro_yearly";

export type TeamPlanId = "pro_team_monthly" | "pro_team_yearly";

export type BillingPlanId = IndividualPlanId | TeamPlanId;

/** The plan family of a plan id; team plans carry Pro limits. */
export type PlanFamily = "go" | "plus" | "pro" | "team";

export const PLAN_FAMILY_BY_ID: ReadonlyMap<BillingPlanId, PlanFamily> = new Map<
  BillingPlanId,
  PlanFamily
>([
  ["go_monthly", "go"],
  ["plus_monthly", "plus"],
  ["plus_yearly", "plus"],
  ["pro_monthly", "pro"],
  ["pro_yearly", "pro"],
  ["pro_team_monthly", "team"],
  ["pro_team_yearly", "team"],
]);

/** The family of a known plan id; `null` for no plan or an unknown (removed) plan. */
export function getPlanTier(planId: string | null | undefined): PlanFamily | null {
  if (!planId) {
    return null;
  }

  return PLAN_FAMILY_BY_ID.get(planId as BillingPlanId) ?? null;
}

/** Billing statuses that keep a plan's limits (a canceled plan also keeps them until its period ends). */
export const ACTIVE_BILLING_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
  "paid",
]);

/** Max Mode (prepaid credits past the plan's pool) is available on every paid plan. */
export function isMaxModeEligible(planId: string | null | undefined): boolean {
  return getPlanTier(planId) !== null;
}

/** Statuses whose plan can spend Max Mode credits: a renewing subscription. */
export const MAX_MODE_USABLE_STATUSES: ReadonlySet<string> = new Set(["active"]);
