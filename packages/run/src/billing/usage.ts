import { MODEL_PRICES_USD_PER_MTOK } from "../agent/model";
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
 * directly through the host's {@link RunUsageBinding}: Run checks the remaining budget
 * before work and records model, browser and computer cost in the product ledger
 * (`product_usage`, product `run`, micro-dollars) after it is incurred.
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

export const assertCanUseTokens = assertBudget;
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

type ModelUsage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  /** The provider's own usage object; OpenRouter's says `is_byok`. */
  raw?: unknown;
};

type OpenRouterUsage = { cost?: unknown; costDetails?: { upstreamInferenceCost?: unknown } };

function usdAmount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * The cost OpenRouter reported for a model call, else an estimate from list prices. With a
 * provider key on OpenRouter (BYOK), `cost` is only OpenRouter's fee, often 0, and the provider's
 * own charge is reported separately as the upstream inference cost.
 */
export function modelCostUsd(
  result: { usage?: ModelUsage; providerMetadata?: unknown },
  modelId: string,
) {
  const usage = (
    result.providerMetadata as { openrouter?: { usage?: OpenRouterUsage } } | undefined
  )?.openrouter?.usage;
  const reported = usdAmount(usage?.cost);
  const byok = (result.usage?.raw as { is_byok?: unknown } | undefined)?.is_byok === true;
  const upstream = usdAmount(usage?.costDetails?.upstreamInferenceCost);
  if (reported !== undefined && !byok) return reported;
  if (reported !== undefined && upstream !== undefined) return reported + upstream;
  const price = MODEL_PRICES_USD_PER_MTOK[modelId];
  if (!price || !result.usage) return 0;
  const input = result.usage.inputTokens ?? 0;
  const output = result.usage.outputTokens ?? Math.max(0, (result.usage.totalTokens ?? 0) - input);
  return (input * price.input + output * price.output) / 1_000_000;
}

export function recordModelUsage(
  userId: string,
  result: { usage?: ModelUsage; providerMetadata?: unknown },
  modelId: string,
) {
  return recordCost(userId, "model", modelCostUsd(result, modelId));
}

/** Report every step of a finished multi-step call (generateText's `steps`). */
export function recordModelSteps(
  userId: string,
  steps: readonly { usage?: ModelUsage; providerMetadata?: unknown }[],
  modelId: string,
) {
  const cost = steps.reduce((sum, step) => sum + modelCostUsd(step, modelId), 0);
  return recordCost(userId, "model", cost);
}

export function usageLimitPayload(error: UsageLimitError) {
  return {
    error: error.message,
    code: error.code,
    metric: error.metric,
  };
}
