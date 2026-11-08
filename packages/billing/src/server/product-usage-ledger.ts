import { sql } from "drizzle-orm";
import { productUsage } from "@deniai/db";

import { usageMonthStart } from "../usage-period";
import type { UsageEngineDatabase } from "./database";

export type UsageProduct = "chat" | "flixa" | "run";

export type ProductUsageDatabase = Pick<UsageEngineDatabase, "select" | "insert">;

/**
 * Add `amount` to the owner's monthly per-product total (`public.product_usage`).
 * Chat and Flixa record their share of the shared quota here when a reservation
 * settles; Deni Run records its spend (micro-dollars) here directly.
 */
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
  database: ProductUsageDatabase,
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
