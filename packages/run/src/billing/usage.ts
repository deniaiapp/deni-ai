import { randomUUID } from "node:crypto";
import { getEffectiveTokenMultiplier } from "@deniai/ai/models";
import { calculateModelUsageAmount, type ModelTokenUsage } from "@deniai/ai/usage-amount";
import { usageUnitsToUsd } from "@deniai/billing";
import { runConfig, runDeps, runLogger, type RunBudget, type RunCostMetric } from "../runtime";
import {
  TIER_BUDGET_USD,
  TIER_NAMES,
  TIER_TEAMMATES,
  UsageLimitError,
  isUsageLimitError,
  type DeniTier,
  type UsageSnapshot,
} from "./plans";
import { readStore } from "../data/store";
import type { Store } from "../types";

export { UsageLimitError, isUsageLimitError };
export type { UsageSnapshot } from "./plans";

/**
 * Deni Run spends the monthly pool of the user's Deni AI plan, shared with chat and
 * Flixa. On the platform the shared usage engine (`@deniai/billing/server`) is called
 * directly through the host's {@link RunUsageBinding}. Model calls spend it exactly like
 * chat ({@link beginModelUsage}): an estimate is reserved before the call, the real amount
 * (weighted tokens times the model's usage tier) is settled after it, and what goes past
 * the pool is paid from Max Mode credits. Browser and computer time is recorded in the
 * product ledger (`product_usage`, product `run`, micro-dollars) after it is incurred and
 * stops once the pool is spent; Max Mode credits do not pay for it.
 */

/** USD of Steel browser time (default $0.10 per hour; `RUN_BROWSER_USD_PER_HOUR`). */
export function browserCostUsd(ms: number) {
  return (Math.max(0, ms) / 3_600_000) * runConfig().browserUsdPerHour;
}

/** USD of E2B sandbox time (default $0.15 per hour; `RUN_COMPUTER_USD_PER_HOUR`). */
export function computerCostUsd(ms: number) {
  return (Math.max(0, ms) / 3_600_000) * runConfig().computerUsdPerHour;
}

export function currentUsageMonth(at = new Date()) {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function budget(userId: string): Promise<RunBudget> {
  return runDeps().usage.getRunBudget(userId);
}

function snapshotFrom(
  usage: RunBudget,
  store: Store,
  live?: { pendingBrowserMs?: number; pendingComputerMs?: number },
): UsageSnapshot {
  const tier = usage.tier as DeniTier;
  const pending =
    browserCostUsd(live?.pendingBrowserMs ?? 0) + computerCostUsd(live?.pendingComputerMs ?? 0);
  const limit = usage.limitUsd || TIER_BUDGET_USD[tier];
  const percent = (usd: number) => (limit > 0 ? (usd / limit) * 100 : 0);
  const parts = {
    chat: percent(usage.poolUsd.chat),
    flixa: percent(usage.poolUsd.flixa),
    run: percent(usage.poolUsd.run + pending),
  };
  return {
    linked: true,
    metered: true,
    plan: tier,
    planName: TIER_NAMES[tier],
    period: currentUsageMonth(),
    periodEnd: usage.periodEnd.toISOString(),
    pool: { usedPercent: parts.chat + parts.flixa + parts.run, parts },
    teammates: { used: store.bots.length, limit: TIER_TEAMMATES[tier] },
    manageUrl: `${runConfig().appUrl}/settings/billing`,
  };
}

/** The usage shown in Run mode; null when the engine cannot be read. */
export async function usageSnapshot(
  userId: string,
  store: Store,
  live?: { pendingBrowserMs?: number; pendingComputerMs?: number },
): Promise<UsageSnapshot | null> {
  try {
    return snapshotFrom(await budget(userId), store, live);
  } catch (error) {
    runLogger().error("[run] usage snapshot", error);
    return null;
  }
}

export async function getUsageSnapshot(userId: string) {
  return usageSnapshot(userId, await readStore(userId));
}

function budgetError(tier: DeniTier) {
  return new UsageLimitError(
    "budget",
    `This month's Deni AI usage is used up on ${TIER_NAMES[tier]}. Upgrade your Deni AI plan to keep going.`,
  );
}

/** Work that spends the pool needs budget left. */
async function assertBudget(userId: string) {
  const usage = await budget(userId);
  if (usage.remainingUsd <= 0) throw budgetError(usage.tier as DeniTier);
}

/**
 * A model call needs the pool or, as in chat, Max Mode credits to continue on. This is the
 * early check; the reservation of the call ({@link beginModelUsage}) decides.
 */
export async function assertCanUseTokens(userId: string) {
  const usage = await budget(userId);
  if (usage.remainingUsd <= 0 && !usage.maxModeEnabled) throw budgetError(usage.tier as DeniTier);
}

export const assertCanStartBrowser = assertBudget;
export const assertCanStartComputer = assertBudget;

/** Running sessions stop once the pool, including their unrecorded time, is spent. */
async function isBudgetSpent(userId: string, pendingUsd: number) {
  try {
    const usage = await budget(userId);
    return usage.remainingUsd - pendingUsd <= 0;
  } catch (error) {
    // Do not cut a live session off because the budget could not be read once.
    runLogger().error("[run] budget check", error);
    return false;
  }
}

export function isBrowserLimitReached(userId: string, pendingMs = 0) {
  return isBudgetSpent(userId, browserCostUsd(pendingMs));
}

export function isComputerLimitReached(userId: string, pendingMs = 0) {
  return isBudgetSpent(userId, computerCostUsd(pendingMs));
}

/** Teammates per plan: Free 5, Go 10, Plus 15, Pro 25 (`TIER_TEAMMATES`). */
export async function teammateLimit(userId: string) {
  const usage = await budget(userId).catch(() => null);
  const tier = (usage?.tier ?? "free") as DeniTier;
  return { tier, limit: TIER_TEAMMATES[tier] };
}

export async function assertCanCreateTeammate(userId: string) {
  const store = await readStore(userId);
  const { tier, limit } = await teammateLimit(userId);
  if (store.bots.length >= limit) {
    throw new UsageLimitError(
      "teammates",
      `Teammate limit reached (${limit} on ${TIER_NAMES[tier]}). Upgrade your Deni AI plan to add more teammates.`,
    );
  }
}

/** Record incurred cost in the shared ledger. Failures are logged, never thrown. */
async function recordCost(userId: string, metric: RunCostMetric, costUsd: number) {
  if (!(costUsd > 0)) return;
  try {
    await runDeps().usage.recordRunCost({ userId, metric, costUsd });
  } catch (error) {
    runLogger().error(`[run] record ${metric} cost`, error);
  }
}

export function recordTimeUsage(userId: string, kind: "browser" | "computer", ms: number) {
  return recordCost(userId, kind, kind === "browser" ? browserCostUsd(ms) : computerCostUsd(ms));
}

type ModelResult = { usage?: ModelTokenUsage };

/** Catalog id of a model id that may carry the Deni AI API author prefix (`anthropic/...`). */
function catalogModelId(modelId: string) {
  return modelId.slice(modelId.lastIndexOf("/") + 1);
}

/**
 * What a model call spends, by the chat rules (`@deniai/ai/usage-amount`): weighted tokens
 * times the model's usage tier and any promotion, in usage units. A model outside the catalog
 * counts as Tier 1.
 */
export function modelUsageUnits(result: ModelResult, modelId: string) {
  if (!result.usage) return 0;
  return calculateModelUsageAmount(catalogModelId(modelId), result.usage, runConfig().usageWeights);
}

/** {@link modelUsageUnits} in USD, the unit of Run's ledger rows. */
export function modelCostUsd(result: ModelResult, modelId: string) {
  return usageUnitsToUsd(modelUsageUnits(result, modelId));
}

/** Reserved before a call, as chat reserves its prompt estimate; the settlement corrects it. */
const MODEL_RESERVATION_TOKENS = 2_048;

/** The model usage of one turn: a reservation on the shared pool, settled with what was spent. */
export type ModelUsage = {
  /** Count a finished model step (or a whole call's usage). */
  add(result: ModelResult): void;
  /** The pool and the Max Mode credits this turn may spend are used up: stop the loop. */
  isSpent(): boolean;
  /** Settle what was spent. Safe to call more than once; never throws. */
  settle(): Promise<void>;
};

/**
 * Reserve usage for the model calls of one turn, the way chat does for a request. Throws
 * {@link UsageLimitError} when the pool is spent and no Max Mode credits can carry the turn.
 * Call `add` after each step and `settle` when the turn ends, however it ends; a turn that
 * never settles is recovered from its last `add` by the usage job.
 */
export async function beginModelUsage(userId: string, modelId: string): Promise<ModelUsage> {
  const binding = runDeps().usage;
  const reservationId = `run:${randomUUID()}:model`;
  const estimate = Math.max(
    1,
    Math.ceil(MODEL_RESERVATION_TOKENS * getEffectiveTokenMultiplier(catalogModelId(modelId))),
  );
  let allowance: number | null;
  try {
    ({ allowance } = await binding.reserveUsage({ userId, reservationId, amount: estimate }));
  } catch (error) {
    // The engine's own limit error: report it as Run's, with the plan in the message.
    if ((error as { name?: unknown } | null)?.name === "UsageLimitError") {
      const usage = await budget(userId).catch(() => null);
      throw budgetError((usage?.tier ?? "free") as DeniTier);
    }
    throw error;
  }
  let spent = 0;
  let settled = false;
  return {
    add(result) {
      spent += modelUsageUnits(result, modelId);
      if (settled) return;
      void binding
        .observeUsage({ userId, reservationId, amount: spent })
        .catch((error) => runLogger().error("[run] observe model usage", error));
    },
    isSpent: () => allowance !== null && spent >= allowance,
    async settle() {
      if (settled) return;
      settled = true;
      try {
        await binding.settleUsage({ userId, reservationId, amount: spent });
      } catch (error) {
        runLogger().error("[run] settle model usage", error);
      }
    },
  };
}

/**
 * Charge model calls that already happened (housekeeping such as summaries): one settled
 * reservation. With the pool spent and no credits it is still recorded, in the ledger.
 */
export async function recordModelSteps(
  userId: string,
  steps: readonly ModelResult[],
  modelId: string,
) {
  if (!steps.some((step) => modelUsageUnits(step, modelId) > 0)) return;
  let usage: ModelUsage;
  try {
    usage = await beginModelUsage(userId, modelId);
  } catch (error) {
    if (!isUsageLimitError(error)) runLogger().error("[run] reserve model usage", error);
    const cost = steps.reduce((sum, step) => sum + modelCostUsd(step, modelId), 0);
    return recordCost(userId, "model", cost);
  }
  for (const step of steps) usage.add(step);
  await usage.settle();
}

export function recordModelUsage(userId: string, result: ModelResult, modelId: string) {
  return recordModelSteps(userId, [result], modelId);
}

/** The plan facts that decide which catalog models the account may use. */
export async function modelAccess(userId: string) {
  const usage = await budget(userId);
  return { tier: usage.tier, hasVerifiedPaymentMethod: usage.hasVerifiedPaymentMethod };
}

export function usageLimitPayload(error: UsageLimitError) {
  return {
    error: error.message,
    code: error.code,
    metric: error.metric,
  };
}
