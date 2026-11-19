import { db } from "@/db/drizzle";
import { usageMonthEnd, usageMonthStart } from "@deniai/billing";
import {
  type ProductUsageDatabase,
  recordProductUsage as recordProductUsageIn,
  type UsageProduct,
} from "@deniai/billing/server";

// The ledger is written by the shared usage engine (@deniai/billing/server) too.
export { usageMonthEnd, usageMonthStart };
export type { ProductUsageDatabase, UsageProduct };

export async function recordProductUsage(
  input: Parameters<typeof recordProductUsageIn>[0],
  database: ProductUsageDatabase = db,
) {
  await recordProductUsageIn(input, database);
}
