import { and, asc, count, eq, gt, inArray, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { billing, member, resetCredit, resetCreditBalance, usageQuota, user } from "@/db/schema";

export const RESET_CREDIT_PLAN_TIERS = ["free", "go", "plus", "pro"] as const;
export type ResetCreditPlanTier = (typeof RESET_CREDIT_PLAN_TIERS)[number];

export type ResetCreditGrantTarget =
  | { type: "all" }
  | { type: "plan"; planTier: ResetCreditPlanTier }
  | { type: "user"; identifier: string };

const ACTIVE_RESET_BILLING_STATUSES = ["active", "trialing", "past_due", "paid"] as const;
const RESET_GRANT_BATCH_SIZE = 500;

function getPaidPlanCondition(planTier?: Exclude<ResetCreditPlanTier, "free">) {
  if (!planTier) {
    return or(
      like(billing.planId, "go_%"),
      like(billing.planId, "plus_%"),
      like(billing.planId, "pro_%"),
    );
  }

  return like(billing.planId, `${planTier}_%`);
}

function getActiveBillingCondition(now: Date) {
  return or(
    inArray(billing.status, ACTIVE_RESET_BILLING_STATUSES),
    and(eq(billing.status, "canceled"), gt(billing.currentPeriodEnd, now)),
  );
}

function getPermanentUserCondition() {
  return or(eq(user.isAnonymous, false), isNull(user.isAnonymous));
}

async function getPaidResetTargetUserIds(
  planTier?: Exclude<ResetCreditPlanTier, "free">,
): Promise<string[]> {
  const activeBillingCondition = getActiveBillingCondition(new Date());
  const planCondition = getPaidPlanCondition(planTier);
  const [personalRows, teamRows] = await Promise.all([
    db
      // Personal rows always have a user; select it from the join for its type.
      .select({ userId: user.id })
      .from(billing)
      .innerJoin(user, eq(billing.userId, user.id))
      .where(
        and(
          getPermanentUserCondition(),
          isNull(billing.organizationId),
          activeBillingCondition,
          planCondition,
        ),
      ),
    db
      .select({ userId: member.userId, planId: billing.planId })
      .from(member)
      .innerJoin(billing, eq(member.organizationId, billing.organizationId))
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        and(
          getPermanentUserCondition(),
          isNotNull(billing.organizationId),
          activeBillingCondition,
          like(billing.planId, "pro_team%"),
        ),
      ),
  ]);

  const activeTeamUserIds = new Set(teamRows.map((row) => row.userId));
  const selectedTeamUserIds = teamRows
    .filter((row) => !planTier || (row.planId != null && row.planId.startsWith(`${planTier}_team`)))
    .map((row) => row.userId);
  const selectedPersonalUserIds = personalRows
    .map((row) => row.userId)
    .filter((userId) => !activeTeamUserIds.has(userId));

  return [...new Set([...selectedTeamUserIds, ...selectedPersonalUserIds])];
}

async function getResetGrantTargetUserIds(target: ResetCreditGrantTarget) {
  const permanentUserCondition = getPermanentUserCondition();

  if (target.type === "user") {
    const identifier = target.identifier.trim();
    const rows = await db
      .select({ userId: user.id })
      .from(user)
      .where(
        and(
          permanentUserCondition,
          or(eq(user.id, identifier), sql`lower(${user.email}) = ${identifier.toLowerCase()}`),
        ),
      )
      .limit(1);
    return rows.map((row) => row.userId);
  }

  if (target.type === "all") {
    const rows = await db.select({ userId: user.id }).from(user).where(permanentUserCondition);
    return rows.map((row) => row.userId);
  }

  if (!RESET_CREDIT_PLAN_TIERS.includes(target.planTier)) {
    throw new Error("Unknown reset target plan.");
  }

  if (target.planTier !== "free") {
    return getPaidResetTargetUserIds(target.planTier);
  }

  const [allUserRows, paidUserIds] = await Promise.all([
    db.select({ userId: user.id }).from(user).where(permanentUserCondition),
    getPaidResetTargetUserIds(),
  ]);
  const paidUsers = new Set(paidUserIds);
  return allUserRows.map((row) => row.userId).filter((userId) => !paidUsers.has(userId));
}

/** A reset credit stays usable for one calendar month from when the user receives it. */
export function resetCreditExpiry(from: Date): Date {
  const expires = new Date(from);
  const day = expires.getUTCDate();
  expires.setUTCMonth(expires.getUTCMonth() + 1);
  // Jan 31 plus a month is the last day of February, not March 3.
  if (expires.getUTCDate() !== day) expires.setUTCDate(0);
  return expires;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function lockUser(tx: Transaction, userId: string) {
  return tx.execute(sql`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`);
}

/**
 * Moves the user's undated v7 count (`reset_credit_balance`, which v7 still grants
 * on the shared database) into credits valid for a month from now, and sets the
 * count to 0 so the same credits cannot also be spent on v7. Needs the user locked.
 */
async function moveLegacyResetCredits(tx: Transaction, userId: string, now: Date) {
  const [legacy] = await tx
    .select({ credits: resetCreditBalance.credits })
    .from(resetCreditBalance)
    .where(and(eq(resetCreditBalance.userId, userId), gt(resetCreditBalance.credits, 0)))
    .for("update");
  if (!legacy) return;
  await tx
    .update(resetCreditBalance)
    .set({ credits: 0, updatedAt: now })
    .where(eq(resetCreditBalance.userId, userId));
  const expiresAt = resetCreditExpiry(now);
  await tx
    .insert(resetCredit)
    .values(Array.from({ length: legacy.credits }, () => ({ userId, expiresAt })));
}

export type AvailableResetCredit = { id: string; expiresAt: Date };

/** The user's unspent, unexpired reset credits, soonest to expire first. */
export async function getAvailableResetCredits(userId: string): Promise<AvailableResetCredit[]> {
  const now = new Date();
  const [legacy] = await db
    .select({ credits: resetCreditBalance.credits })
    .from(resetCreditBalance)
    .where(and(eq(resetCreditBalance.userId, userId), gt(resetCreditBalance.credits, 0)))
    .limit(1);
  // Most reads find no v7 count and take no lock.
  if (legacy) {
    await db.transaction(
      async (tx) => {
        await lockUser(tx, userId);
        await moveLegacyResetCredits(tx, userId, now);
      },
      { isolationLevel: "read committed" },
    );
  }

  return db
    .select({ id: resetCredit.id, expiresAt: resetCredit.expiresAt })
    .from(resetCredit)
    .where(
      and(
        eq(resetCredit.userId, userId),
        isNull(resetCredit.usedAt),
        gt(resetCredit.expiresAt, now),
      ),
    )
    .orderBy(asc(resetCredit.expiresAt), asc(resetCredit.createdAt));
}

export async function grantResetCredits({
  target,
  quantity,
  adminEmail,
}: {
  target: ResetCreditGrantTarget;
  quantity: number;
  adminEmail: string;
}) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new Error("Reset credit quantity must be between 1 and 100.");
  }

  const userIds = await getResetGrantTargetUserIds(target);
  if (userIds.length === 0) {
    return { matchedUsers: 0, grantedUsers: 0, quantity };
  }

  // postgres.js needs Date values in raw SQL as ISO strings.
  const expiresAt = resetCreditExpiry(new Date()).toISOString();
  let grantedUsers = 0;
  for (let index = 0; index < userIds.length; index += RESET_GRANT_BATCH_SIZE) {
    const batch = userIds.slice(index, index + RESET_GRANT_BATCH_SIZE);
    // `quantity` rows per user, generated in the database rather than sent row by row.
    const [row] = await db.execute<{ users: number }>(sql`
      WITH granted AS (
        INSERT INTO ${resetCredit} (user_id, expires_at)
        SELECT ${user.id}, ${expiresAt}::timestamp
        FROM ${user} CROSS JOIN generate_series(1, ${quantity})
        WHERE ${inArray(user.id, batch)}
        RETURNING user_id
      )
      SELECT count(DISTINCT user_id)::int AS users FROM granted
    `);
    grantedUsers += Number(row?.users ?? 0);
  }

  console.info("[reset-credits] Admin reset credits granted", {
    adminEmail,
    target,
    quantity,
    matchedUsers: userIds.length,
    grantedUsers,
  });

  return { matchedUsers: userIds.length, grantedUsers, quantity };
}

/**
 * Spends one reset credit and clears the user's usage. `creditId` picks the credit
 * (the billing page lists them); without it the soonest to expire is spent.
 * Returns the number of credits left, or null when none could be spent.
 */
export async function consumeResetCredit(userId: string, creditId?: string) {
  const now = new Date();
  return db.transaction(
    async (tx) => {
      await lockUser(tx, userId);
      await moveLegacyResetCredits(tx, userId, now);

      const usable = and(
        eq(resetCredit.userId, userId),
        isNull(resetCredit.usedAt),
        gt(resetCredit.expiresAt, now),
      );
      const [credit] = await tx
        .select({ id: resetCredit.id })
        .from(resetCredit)
        .where(creditId ? and(usable, eq(resetCredit.id, creditId)) : usable)
        .orderBy(asc(resetCredit.expiresAt), asc(resetCredit.createdAt))
        .limit(1);
      if (!credit) {
        return null;
      }

      await tx.update(resetCredit).set({ usedAt: now }).where(eq(resetCredit.id, credit.id));

      await tx
        .update(usageQuota)
        .set({ used: 0, periodStart: now, updatedAt: now })
        .where(eq(usageQuota.userId, userId));

      // A quota reward does not erase incurred charges or a whole team's ledger.
      const [remaining] = await tx.select({ count: count() }).from(resetCredit).where(usable);
      return remaining?.count ?? 0;
    },
    { isolationLevel: "read committed" },
  );
}
