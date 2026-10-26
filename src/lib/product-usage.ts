import { and, eq } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { productUsage } from "@/db/schema";
import {
  type ProductUsageDatabase,
  recordProductUsage,
  usageMonthEnd,
  usageMonthStart,
} from "@/lib/product-usage-ledger";
import { getUsageSummary, type SubscriptionTier } from "@/lib/usage";
import { usageUnitsToUsd } from "@/lib/usage-pool";

export type { UsageProduct } from "@/lib/product-usage-ledger";
export type DeniRunMetric = "model" | "browser" | "computer";

export const DENI_RUN_METRICS: readonly DeniRunMetric[] = ["model", "browser", "computer"];

const USD_MICROS = 1_000_000;

async function currentMonthRows(userId: string, now: Date, database: ProductUsageDatabase = db) {
  return database
    .select({
      product: productUsage.product,
      metric: productUsage.metric,
      unit: productUsage.unit,
      used: productUsage.used,
    })
    .from(productUsage)
    .where(
      and(eq(productUsage.userId, userId), eq(productUsage.periodStart, usageMonthStart(now))),
    );
}

export type DeniRunUsage = {
  tier: SubscriptionTier;
  periodEnd: Date;
  /**
   * The plan's shared pool in USD: Deni AI chat and Flixa (converted from usage
   * units) and Deni Run all spend it, so `usedUsd` includes all three.
   */
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
  /** `usedUsd` by product: Deni AI chat, Flixa, and Deni Run. */
  poolUsd: { chat: number; flixa: number; run: number };
  /** Deni Run's own spend by kind. */
  breakdownUsd: Record<DeniRunMetric, number>;
};

/** The shared pool as Deni Run sees it (GET/POST /api/integrations/deni-run/usage). */
export async function getDeniRunUsage(userId: string, now = new Date()): Promise<DeniRunUsage> {
  const [summary, rows] = await Promise.all([
    getUsageSummary({ userId, now }),
    currentMonthRows(userId, now),
  ]);
  const breakdownMicros: Record<DeniRunMetric, number> = { model: 0, browser: 0, computer: 0 };
  for (const row of rows) {
    if (row.product !== "run" || row.unit !== "usd_micros") continue;
    if ((DENI_RUN_METRICS as readonly string[]).includes(row.metric))
      breakdownMicros[row.metric as DeniRunMetric] += Number(row.used);
  }
  const pool = summary.pool;
  const limitUnits = pool?.limit ?? 0;
  const used = pool?.used ?? { chat: 0, flixa: 0, run: 0 };
  const usedUnits = used.chat + used.flixa + used.run;
  return {
    tier: summary.tier,
    periodEnd: pool?.periodEnd ?? usageMonthEnd(now),
    limitUsd: usageUnitsToUsd(limitUnits),
    usedUsd: usageUnitsToUsd(usedUnits),
    remainingUsd: usageUnitsToUsd(Math.max(limitUnits - usedUnits, 0)),
    poolUsd: {
      chat: usageUnitsToUsd(used.chat),
      flixa: usageUnitsToUsd(used.flixa),
      run: usageUnitsToUsd(used.run),
    },
    breakdownUsd: {
      model: breakdownMicros.model / USD_MICROS,
      browser: breakdownMicros.browser / USD_MICROS,
      computer: breakdownMicros.computer / USD_MICROS,
    },
  };
}

/** Deni Run reports cost after it is incurred, so the budget may overrun by one step. */
export async function recordDeniRunUsage({
  userId,
  metric,
  costUsd,
  at = new Date(),
}: {
  userId: string;
  metric: DeniRunMetric;
  costUsd: number;
  at?: Date;
}) {
  if (!Number.isFinite(costUsd) || costUsd < 0)
    throw new Error("Cost must be a nonnegative number.");
  await recordProductUsage({
    userId,
    product: "run",
    metric,
    unit: "usd_micros",
    amount: Math.round(costUsd * USD_MICROS),
    at,
  });
}
