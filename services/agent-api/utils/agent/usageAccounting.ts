import type { AgentAuthContext } from "../../middleware/validateAgentAuth";
import { recordFlixaObservedUsage, settleFlixaUsage } from "../deni/flixaUsage";
import { computeMeteredTokens } from "./usageMetering";
import { getLongContextUsageMultiplier } from "./models";

/** How often a running shared reservation refreshes its recovery lease (as the web chat does). */
const USAGE_LEASE_INTERVAL_MS = 30_000;
/** A request still unsettled after this long stops refreshing; recovery takes over. */
const USAGE_LEASE_MAX_MS = 6 * 60 * 60_000;

/** Usage units for a provider usage object (or the estimate, without one). */
function meteredAmount(auth: AgentAuthContext, usage: unknown, completed: boolean): number {
  const meteredUsage = auth.usageEstimate?.usageWithFallback(usage, completed) ?? usage;
  const weighted = computeMeteredTokens(meteredUsage);
  return weighted === null
    ? (auth.usageReservation?.amount ?? 0)
    : Math.max(
        0,
        Math.ceil(
          weighted *
            auth.tokenUsageMultiplier *
            getLongContextUsageMultiplier(auth.modelId, meteredUsage),
        ),
      );
}

function stopUsageLease(auth: AgentAuthContext): void {
  auth.stopUsageLease?.();
  auth.stopUsageLease = undefined;
}

/**
 * While a shared-engine request runs, persist what it has observed so far every
 * 30 s. If the process dies before settlement, the usage recovery job settles the
 * reservation at this amount once it is 15 minutes stale, instead of keeping the
 * whole estimate (legacy) or charging nothing.
 */
export function startUsageLease(auth: AgentAuthContext): void {
  const reservation = auth.usageReservation;
  if (!auth.usageMeteringEnabled || !auth.usageReserved || reservation?.engine !== "shared") return;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (!auth.usageReserved || Date.now() - startedAt > USAGE_LEASE_MAX_MS) {
      stopUsageLease(auth);
      return;
    }
    const amount = auth.usageEstimate ? meteredAmount(auth, undefined, false) : 0;
    recordFlixaObservedUsage(reservation, amount).catch((error: unknown) => {
      console.error(`[Usage] Observed usage failed reservation=${reservation.id}:`, error);
    });
  }, USAGE_LEASE_INTERVAL_MS);
  timer.unref?.();
  auth.stopUsageLease = () => clearInterval(timer);
}

async function settle(auth: AgentAuthContext | undefined, amount: number): Promise<void> {
  if (!auth?.usageMeteringEnabled || !auth.usageReserved || !auth.usageReservation) return;
  // Claim the request before the first await: stream completion, cancel, and
  // the enclosing route's error handler must not choose different settlements.
  auth.usageReserved = false;
  stopUsageLease(auth);
  try {
    await settleFlixaUsage(auth.usageReservation, amount);
  } catch (error) {
    // Keep the durable reservation charged on failure; never silently give the
    // allowance back. Legacy receipts allow reconciliation after an outage; shared
    // reservations are recovered at their observed amount once stale.
    console.error(`[Usage] Settlement failed reservation=${auth.usageReservation.id}:`, error);
  }
}

export async function finalizeUsage(
  auth: AgentAuthContext | undefined,
  usage: unknown,
  completed = true,
): Promise<void> {
  if (!auth?.usageMeteringEnabled) return;
  const amount = meteredAmount(auth, usage, completed);
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
