import { and, eq, isNotNull, isNull, like } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { billing, member, teamMemberUsagePolicy, teamUsagePolicy } from "@/db/schema";
import { getPlanTier } from "@/lib/billing";
import {
  getMaxModeCreditSummary,
  MAX_MODE_CREDIT_MAX,
  MAX_MODE_CREDIT_MIN,
  MAX_MODE_CREDIT_PACKS,
  type MaxModeCreditOwner,
  type MaxModeCreditSummary,
} from "@/lib/max-mode-credits";
import { canonicalTeamBillingRow } from "@/lib/team-billing-record";

type MaxModeDatabase = Pick<typeof db, "select" | "update">;

/** Max Mode (prepaid credits past the plan's pool) is available on every paid plan. */
export function isMaxModeEligible(planId: string | null | undefined): boolean {
  return getPlanTier(planId) !== null;
}

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due", "paid"]);
/** Statuses whose plan can spend credits: a renewing subscription. */
export const MAX_MODE_USABLE_STATUSES = new Set(["active"]);

async function isTeamOwner(userId: string, organizationId: string) {
  const [memberRecord] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);

  return memberRecord?.role === "owner";
}

/**
 * Find the billing record that should be used for Max Mode operations.
 * Uses the team billing record when the user is on an active team plan,
 * otherwise falls back to the personal billing record.
 */
export async function getEffectiveBillingRecord(userId: string, database: MaxModeDatabase = db) {
  const selectFields = {
    id: billing.id,
    organizationId: billing.organizationId,
    planId: billing.planId,
    status: billing.status,
    deletionPending: billing.deletionPending,
    stripeCustomerId: billing.stripeCustomerId,
    maxModeEnabled: billing.maxModeEnabled,
  };

  // Check for active team plan first
  const teamRecords = await database
    .select(selectFields)
    .from(billing)
    .innerJoin(member, eq(billing.organizationId, member.organizationId))
    .where(
      and(
        eq(member.userId, userId),
        isNotNull(billing.organizationId),
        canonicalTeamBillingRow(),
        like(billing.planId, "pro_team%"),
      ),
    );

  const teamRecord = teamRecords.find(
    (candidate) => candidate.status && ACTIVE_STATUSES.has(candidate.status),
  );

  if (teamRecord) {
    return teamRecord;
  }

  // Fall back to personal billing record
  const [personal] = await database
    .select(selectFields)
    .from(billing)
    .where(and(eq(billing.userId, userId), isNull(billing.organizationId)))
    .limit(1);

  return personal ?? null;
}

/** Team credits belong to the organization, personal credits to the user. */
function creditOwnerOf(
  userId: string,
  record: { organizationId: string | null },
): MaxModeCreditOwner {
  return record.organizationId
    ? { userId: null, organizationId: record.organizationId }
    : { userId, organizationId: null };
}

export type MaxModeStatus = {
  eligible: boolean;
  enabled: boolean;
  memberEnabled: boolean;
  isTeam: boolean;
  /** Whether this user can buy credits and change Max Mode settings (team owners only on teams). */
  canManage: boolean;
  credits: MaxModeCreditSummary | null;
  packs: readonly number[];
  minCredits: number;
  maxCredits: number;
};

const creditLimits = {
  packs: MAX_MODE_CREDIT_PACKS,
  minCredits: MAX_MODE_CREDIT_MIN,
  maxCredits: MAX_MODE_CREDIT_MAX,
};

async function getMemberMaxModeEnabled(userId: string, organizationId: string) {
  const [[memberPolicy], [defaultPolicy]] = await Promise.all([
    db
      .select({ maxModeEnabled: teamMemberUsagePolicy.maxModeEnabled })
      .from(teamMemberUsagePolicy)
      .where(
        and(
          eq(teamMemberUsagePolicy.organizationId, organizationId),
          eq(teamMemberUsagePolicy.userId, userId),
        ),
      )
      .limit(1),
    db
      .select({ defaultMaxModeEnabled: teamUsagePolicy.defaultMaxModeEnabled })
      .from(teamUsagePolicy)
      .where(eq(teamUsagePolicy.organizationId, organizationId))
      .limit(1),
  ]);
  return memberPolicy?.maxModeEnabled ?? defaultPolicy?.defaultMaxModeEnabled ?? true;
}

export async function getMaxModeStatus(userId: string): Promise<MaxModeStatus> {
  const record = await getEffectiveBillingRecord(userId);

  if (!record) {
    return {
      eligible: false,
      enabled: false,
      memberEnabled: true,
      isTeam: false,
      canManage: false,
      credits: null,
      ...creditLimits,
    };
  }

  const eligible =
    !record.deletionPending &&
    isMaxModeEligible(record.planId) &&
    MAX_MODE_USABLE_STATUSES.has(record.status ?? "");
  const [memberEnabled, canManage, credits] = await Promise.all([
    record.organizationId ? getMemberMaxModeEnabled(userId, record.organizationId) : true,
    record.organizationId ? isTeamOwner(userId, record.organizationId) : true,
    getMaxModeCreditSummary(creditOwnerOf(userId, record)),
  ]);

  return {
    eligible,
    enabled: eligible && record.maxModeEnabled && memberEnabled,
    memberEnabled,
    isTeam: Boolean(record.organizationId),
    canManage,
    credits,
    ...creditLimits,
  };
}

/** The credit owner and Stripe customer a user may manage credits for, or an error. */
export async function getMaxModeCreditTarget(
  userId: string,
): Promise<
  | { ok: true; owner: MaxModeCreditOwner; stripeCustomerId: string; returnPath: string }
  | { ok: false; error: string }
> {
  const record = await getEffectiveBillingRecord(userId);
  if (!record) return { ok: false, error: "No billing record found." };
  if (record.deletionPending) return { ok: false, error: "Account deletion is in progress." };
  if (!isMaxModeEligible(record.planId) || !MAX_MODE_USABLE_STATUSES.has(record.status ?? ""))
    return { ok: false, error: "Max Mode credits are available on active paid plans." };
  if (record.organizationId && !(await isTeamOwner(userId, record.organizationId)))
    return { ok: false, error: "Only organization owners can manage team Max Mode." };
  return {
    ok: true,
    owner: creditOwnerOf(userId, record),
    stripeCustomerId: record.stripeCustomerId,
    returnPath: record.organizationId ? "/settings/team" : "/settings/billing",
  };
}

export async function enableMaxMode(userId: string): Promise<{ success: boolean; error?: string }> {
  const record = await getEffectiveBillingRecord(userId);

  if (!record) {
    return { success: false, error: "No billing record found." };
  }
  if (record.deletionPending) return { success: false, error: "Account deletion is in progress." };

  if (!isMaxModeEligible(record.planId) || !MAX_MODE_USABLE_STATUSES.has(record.status ?? "")) {
    return { success: false, error: "Max Mode credits are available on active paid plans." };
  }

  if (record.organizationId && !(await isTeamOwner(userId, record.organizationId))) {
    return { success: false, error: "Only organization owners can manage team Max Mode." };
  }

  if (record.maxModeEnabled) {
    return { success: true };
  }

  await db.update(billing).set({ maxModeEnabled: true }).where(eq(billing.id, record.id));

  return { success: true };
}

export async function disableMaxMode(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  const record = await getEffectiveBillingRecord(userId);

  if (!record) {
    return { success: false, error: "No billing record found." };
  }

  if (!record.maxModeEnabled) {
    return { success: true }; // Already disabled
  }

  if (record.organizationId && !(await isTeamOwner(userId, record.organizationId))) {
    return { success: false, error: "Only organization owners can manage team Max Mode." };
  }

  await db
    .update(billing)
    .set({
      maxModeEnabled: false,
    })
    .where(eq(billing.id, record.id));

  return { success: true };
}
