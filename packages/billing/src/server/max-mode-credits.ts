import { and, asc, eq, gt, sql } from "drizzle-orm";
import { maxModeCreditLot } from "@deniai/db";

import type { UsageEngineDatabase } from "./database";

export type MaxModeCreditDatabase = Pick<UsageEngineDatabase, "select" | "update">;

/** Credits belong to a user (personal plans) or an organization (team plans). */
export type MaxModeCreditOwner =
  | { userId: string; organizationId: null }
  | { userId: null; organizationId: string };

export function creditOwnerFor(record: {
  userId: string | null;
  organizationId: string | null;
}): MaxModeCreditOwner | null {
  if (record.organizationId) return { userId: null, organizationId: record.organizationId };
  return record.userId ? { userId: record.userId, organizationId: null } : null;
}

export function maxModeCreditLotOwnerCondition(owner: MaxModeCreditOwner) {
  return owner.organizationId
    ? eq(maxModeCreditLot.organizationId, owner.organizationId)
    : eq(maxModeCreditLot.userId, owner.userId!);
}

function spendableLots(owner: MaxModeCreditOwner, now: Date) {
  return and(
    maxModeCreditLotOwnerCondition(owner),
    gt(maxModeCreditLot.remainingUnits, 0),
    gt(maxModeCreditLot.expiresAt, now),
  );
}

/** Unexpired, unspent units of the owner. */
export async function getMaxModeCreditUnits(
  owner: MaxModeCreditOwner,
  now: Date,
  database: Pick<UsageEngineDatabase, "select">,
) {
  const [row] = await database
    .select({ units: sql<string | null>`sum(${maxModeCreditLot.remainingUnits})` })
    .from(maxModeCreditLot)
    .where(spendableLots(owner, now));
  return Number(row?.units ?? 0);
}

/**
 * Spend up to `units` from the lots that expire first, inside the caller's
 * transaction, and return what was spent. The lots are locked so team members
 * settling at once cannot spend the same credit twice.
 */
export async function spendMaxModeCredits(
  owner: MaxModeCreditOwner,
  units: number,
  now: Date,
  database: MaxModeCreditDatabase,
) {
  if (units <= 0) return 0;
  const lots = await database
    .select({ id: maxModeCreditLot.id, remaining: maxModeCreditLot.remainingUnits })
    .from(maxModeCreditLot)
    .where(spendableLots(owner, now))
    .orderBy(asc(maxModeCreditLot.expiresAt), asc(maxModeCreditLot.createdAt))
    .for("update");
  let left = units;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(left, lot.remaining);
    await database
      .update(maxModeCreditLot)
      .set({ remainingUnits: sql`${maxModeCreditLot.remainingUnits} - ${take}` })
      .where(eq(maxModeCreditLot.id, lot.id));
    left -= take;
  }
  return units - left;
}
