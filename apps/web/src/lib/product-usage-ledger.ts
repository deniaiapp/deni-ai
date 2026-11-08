import { sql } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { productUsage } from "@/db/schema";

export type UsageProduct = "chat" | "flixa" | "run";

export type ProductUsageDatabase = Pick<typeof db, "select" | "insert">;

/** The UTC calendar month a usage amount belongs to, matching the quota reset window. */
export function usageMonthStart(at: Date) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

export function usageMonthEnd(at: Date) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

export async function recordProductUsage(
  {
    userId,
    product,
    metric,
    unit,
    amount,
    at = new Date(),
  }: {
    userId: string;
    product: UsageProduct;
    metric: string;
    unit: string;
    amount: number;
    at?: Date;
  },
  database: ProductUsageDatabase = db,
) {
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new Error("Product usage must be a nonnegative safe integer.");
  if (amount === 0) return;
  const now = new Date();
  await database
    .insert(productUsage)
    .values({
      userId,
      product,
      metric,
      unit,
      periodStart: usageMonthStart(at),
      used: amount,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        productUsage.userId,
        productUsage.product,
        productUsage.metric,
        productUsage.unit,
        productUsage.periodStart,
      ],
      set: { used: sql`${productUsage.used} + ${amount}`, updatedAt: now },
    });
}
