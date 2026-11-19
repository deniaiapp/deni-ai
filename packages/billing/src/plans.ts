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

/** How often a plan is billed, read from its id; `null` for no plan or an unknown one. */
export function getPlanInterval(planId: string | null | undefined): "monthly" | "yearly" | null {
  if (getPlanTier(planId) === null) return null;
  return planId!.endsWith("_yearly") ? "yearly" : "monthly";
}

const PLAN_FAMILY_RANK: Readonly<Record<PlanFamily, number>> = { go: 1, plus: 2, pro: 3, team: 3 };

/**
 * What a change of plan does to the subscription:
 *
 * - `upgrade`: a higher tier, or the same tier billed yearly instead of monthly. It
 *   applies at once and starts a new billing cycle: the new plan is paid in full, less
 *   the unused time on the old one, and (the usage period follows the billing cycle)
 *   comes with a new usage pool.
 * - `downgrade`: a lower tier, or the same tier billed monthly instead of yearly. It
 *   applies when the paid period ends and gives no credit. Applied at once it would
 *   refund time whose pool may already be spent, and upgrading again would buy a new
 *   pool for the price of a day.
 * - `none`: the same plan.
 *
 * A current plan this build does not know counts as below every plan.
 */
export type PlanChangeKind = "upgrade" | "downgrade" | "none";

export function getPlanChangeKind(
  fromPlanId: string | null | undefined,
  toPlanId: string | null | undefined,
): PlanChangeKind {
  const from = getPlanTier(fromPlanId);
  const to = getPlanTier(toPlanId);
  if (!to || !from) return "upgrade";
  if (fromPlanId === toPlanId) return "none";
  if (PLAN_FAMILY_RANK[to] !== PLAN_FAMILY_RANK[from]) {
    return PLAN_FAMILY_RANK[to] > PLAN_FAMILY_RANK[from] ? "upgrade" : "downgrade";
  }
  return getPlanInterval(toPlanId) === "yearly" && getPlanInterval(fromPlanId) === "monthly"
    ? "upgrade"
    : "downgrade";
}
