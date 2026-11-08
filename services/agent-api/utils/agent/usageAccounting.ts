import type { AgentAuthContext } from "../../middleware/validateAgentAuth";
import { settleUsageQuota } from "../deni/usage";
import { computeMeteredTokens } from "./usageMetering";
import { getLongContextUsageMultiplier } from "./models";

async function settle(auth: AgentAuthContext | undefined, amount: number): Promise<void> {
  if (!auth?.usageMeteringEnabled || !auth.usageReserved || !auth.usageReservation) return;
  // Claim the request before the first await: stream completion, cancel, and
  // the enclosing route's error handler must not choose different settlements.
  auth.usageReserved = false;
  try {
    await settleUsageQuota(auth.usageReservation, amount);
  } catch (error) {
    // Keep the durable reservation charged on failure; never silently give the
    // allowance back. The receipt allows reconciliation after an outage.
    console.error(`[Usage] Settlement failed reservation=${auth.usageReservation.id}:`, error);
  }
}

export async function finalizeUsage(
  auth: AgentAuthContext | undefined,
  usage: unknown,
  completed = true,
): Promise<void> {
  if (!auth?.usageMeteringEnabled) return;
  const meteredUsage = auth.usageEstimate?.usageWithFallback(usage, completed) ?? usage;
  const weighted = computeMeteredTokens(meteredUsage);
  const amount =
    weighted === null
      ? (auth.usageReservation?.amount ?? 0)
      : Math.max(
          0,
          Math.ceil(
            weighted *
              auth.tokenUsageMultiplier *
              getLongContextUsageMultiplier(auth.modelId, meteredUsage),
          ),
        );
  const pending = settle(auth, amount);
  const raw = process.env.FLIXA_USAGE_FINALIZE_ASYNC?.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw ?? "")) {
    void pending;
  } else {
    await pending;
  }
}

/** Only failures before a successful upstream response refund the full hold. */
export async function releaseReservedUsage(auth: AgentAuthContext | undefined): Promise<void> {
  await settle(auth, 0);
}
