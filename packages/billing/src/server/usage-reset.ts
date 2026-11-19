import { and, eq, gt } from "drizzle-orm";
import { productUsage, usageQuota } from "@deniai/db";

import { usageMonthStart } from "../usage-period";
import type { UsageEngineDatabase } from "./database";

export type UsageResetDatabase = Pick<UsageEngineDatabase, "select" | "update">;

/**
 * Whether clearing the user's usage would change anything: live shared-pool usage
 * (chat and Flixa in `usage_quota`) or Deni Run spend this month (its
 * `product_usage` ledger, which the pool counts alongside the quota).
 */
export async function hasResettableUsage(
  userId: string,
  now: Date,
  database: Pick<UsageEngineDatabase, "select">,
) {
  const [quotaRows, runRows] = await Promise.all([
    database
      .select({ userId: usageQuota.userId })
      .from(usageQuota)
      .where(
        and(
          eq(usageQuota.userId, userId),
          eq(usageQuota.unit, "units"),
          gt(usageQuota.used, 0),
          gt(usageQuota.periodEnd, now),
        ),
      )
      .limit(1),
    database
      .select({ userId: productUsage.userId })
      .from(productUsage)
      .where(
        and(
          eq(productUsage.userId, userId),
          eq(productUsage.product, "run"),
          eq(productUsage.unit, "usd_micros"),
          eq(productUsage.periodStart, usageMonthStart(now)),
          gt(productUsage.used, 0),
        ),
      )
      .limit(1),
  ]);
  return quotaRows.length > 0 || runRows.length > 0;
}

/**
 * Clears the user's own usage of the shared pool: the quota rows and this month's
 * product ledger (the Deni Run budget and the chat/Flixa split of the quota). Charges
 * already incurred (Max Mode credits, invoices) and teammates' usage stay as they are.
 * Run it in the caller's transaction, with the user locked.
 */
export async function resetUserUsage(userId: string, now: Date, database: UsageResetDatabase) {
  await database
    .update(usageQuota)
    .set({ used: 0, periodStart: now, updatedAt: now })
    .where(eq(usageQuota.userId, userId));
  await database
    .update(productUsage)
    .set({ used: 0, updatedAt: now })
    .where(
      and(eq(productUsage.userId, userId), eq(productUsage.periodStart, usageMonthStart(now))),
    );
}
