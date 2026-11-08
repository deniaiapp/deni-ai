import type { UsageEngine } from "@deniai/billing/server";
import type { RunUsageBinding } from "./runtime";

/** Bind Run's usage checks and charges to the shared usage engine. */
export function runUsageBinding(
  engine: Pick<UsageEngine, "getRunBudget" | "recordRunCost">,
): RunUsageBinding {
  return {
    getRunBudget: (userId) => engine.getRunBudget(userId),
    recordRunCost: (input) => engine.recordRunCost(input),
  };
}
