import type { UsageEngine } from "@deniai/billing/server";
import type { RunUsageBinding } from "./runtime";

/** Bind Run's usage checks and charges to the shared usage engine. */
export function runUsageBinding(
  engine: Pick<
    UsageEngine,
    "getRunBudget" | "recordRunCost" | "consumeUsage" | "recordObservedUsage" | "settleUsage"
  >,
): RunUsageBinding {
  return {
    getRunBudget: (userId) => engine.getRunBudget(userId),
    recordRunCost: (input) => engine.recordRunCost(input),
    // Run's model calls are reservations on the one shared quota row, recorded for `run`.
    reserveUsage: async ({ userId, reservationId, amount }) => {
      const reservation = await engine.consumeUsage({
        userId,
        category: "basic",
        product: "run",
        reservationId,
        amount,
      });
      return { allowance: reservation.allowance };
    },
    observeUsage: (input) => engine.recordObservedUsage(input),
    settleUsage: async (input) => {
      await engine.settleUsage(input);
    },
  };
}
