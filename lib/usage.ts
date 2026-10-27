import "@tanstack/react-start/server-only";

import {
  DeniAiAccountMissingError,
  DeniAiUnavailableError,
  cachedDeniRunUsage,
  deniAiUrl,
  deniAiUsageConfigured,
  fetchDeniRunUsage,
  getLinkedDeniAiUserId,
  reportDeniRunCost,
  type DeniRunCostMetric,
  type DeniRunUsage,
} from "./deni-ai";
import { MODEL_PRICES_USD_PER_MTOK } from "./model";
import {
  TIER_BUDGET_USD,
  TIER_NAMES,
  TIER_TEAMMATES,
  UsageLimitError,
  isUsageLimitError,
  type DeniTier,
  type UsageSnapshot,
} from "./plans";
import { readStore } from "./store";
import type { Store } from "./types";

export { UsageLimitError, isUsageLimitError };
export type { UsageSnapshot } from "./plans";

/**
 * Deni Run spends a monthly USD budget that belongs to the user's Deni AI plan.
 * Deni AI keeps the ledger: Deni Run checks the remaining budget before work and
 * reports what model calls, browser time, and computer time actually cost.
 */

function hourlyRate(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && process.env[name]?.trim() ? value : fallback;
}

/** USD per hour of Steel browser and E2B sandbox time (provider cost; override per deployment). */
export function browserCostUsd(ms: number) {
  return (Math.max(0, ms) / 3_600_000) * hourlyRate("DENI_RUN_BROWSER_USD_PER_HOUR", 0.1);
}

export function computerCostUsd(ms: number) {
  return (Math.max(0, ms) / 3_600_000) * hourlyRate("DENI_RUN_COMPUTER_USD_PER_HOUR", 0.15);
}

export function currentUsageMonth(at = new Date()) {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Budget =
  | { metered: false }
  | { metered: true; linked: false }
  | { metered: true; linked: true; deniUserId: string; usage: DeniRunUsage };

async function resolveBudget(userId: string): Promise<Budget> {
  if (!deniAiUsageConfigured()) {
    // A development deployment without Deni AI runs unmetered; production must be configured.
    if (process.env.NODE_ENV === "production") {
      throw new DeniAiUnavailableError("Deni AI usage is not configured on this deployment.");
    }
    return { metered: false };
  }
  const deniUserId = await getLinkedDeniAiUserId(userId);
  if (!deniUserId) return { metered: true, linked: false };
  try {
    return { metered: true, linked: true, deniUserId, usage: await fetchDeniRunUsage(deniUserId) };
  } catch (error) {
    if (error instanceof DeniAiAccountMissingError) return { metered: true, linked: false };
    throw error;
  }
}

/** Without a linked Deni AI plan (or on an unmetered development deployment), Free limits apply. */
function tierOf(budget: Budget): DeniTier {
  return budget.metered && budget.linked ? budget.usage.tier : "free";
}

function snapshotFrom(
  budget: Budget,
  store: Store,
  live?: { pendingBrowserMs?: number; pendingComputerMs?: number },
): UsageSnapshot {
  const tier = tierOf(budget);
  const usage = budget.metered && budget.linked ? budget.usage : null;
  const pending = browserCostUsd(live?.pendingBrowserMs ?? 0) + computerCostUsd(live?.pendingComputerMs ?? 0);
  const limit = usage?.limitUsd ?? TIER_BUDGET_USD[tier];
  const percent = (usd: number) => (limit > 0 ? (usd / limit) * 100 : 0);
  const parts = {
    chat: percent(usage?.poolUsd.chat ?? 0),
    flixa: percent(usage?.poolUsd.flixa ?? 0),
    run: percent((usage?.poolUsd.run ?? 0) + pending),
  };
  return {
    linked: budget.metered ? budget.linked : true,
    metered: budget.metered,
    plan: tier,
    planName: TIER_NAMES[tier],
    period: currentUsageMonth(),
    periodEnd: usage?.periodEnd ?? null,
    pool: { usedPercent: parts.chat + parts.flixa + parts.run, parts },
    teammates: { used: store.bots.length, limit: TIER_TEAMMATES[tier] },
    manageUrl: usage?.manageUrl ?? `${deniAiUrl()}/settings/billing`,
  };
}

/** The usage shown in the workspace; null while Deni AI cannot be reached. */
export async function usageSnapshot(
  userId: string,
  store: Store,
  live?: { pendingBrowserMs?: number; pendingComputerMs?: number },
  options?: { cachedOnly?: boolean },
): Promise<UsageSnapshot | null> {
  try {
    if (options?.cachedOnly) {
      // Opening the workspace should not wait on Deni AI. Without a cached budget, answer null
      // now and warm the cache, so the request the client sends next finds it.
      const deniUserId = deniAiUsageConfigured() ? await getLinkedDeniAiUserId(userId) : null;
      if (deniUserId && !cachedDeniRunUsage(deniUserId)) {
        void fetchDeniRunUsage(deniUserId).catch(() => undefined);
        return null;
      }
    }
    return snapshotFrom(await resolveBudget(userId), store, live);
  } catch (error) {
    console.error("deni ai usage snapshot", error);
    return null;
  }
}

export async function getUsageSnapshot(userId: string) {
  return usageSnapshot(userId, await readStore(userId));
}

function budgetError(budget: Extract<Budget, { linked: true }>) {
  const tier = budget.usage.tier;
  return new UsageLimitError(
    "budget",
    `This month's Deni AI usage is used up on ${TIER_NAMES[tier]}. Upgrade your Deni AI plan to keep going.`,
  );
}

/** Work that spends budget needs a linked Deni AI account with budget left. */
async function assertBudget(userId: string) {
  const budget = await resolveBudget(userId);
  if (!budget.metered) return;
  if (!budget.linked) {
    throw new UsageLimitError("link", "Connect your Deni AI account to use Deni Run.");
  }
  if (budget.usage.usedUsd >= budget.usage.limitUsd) throw budgetError(budget);
}

export const assertCanUseTokens = assertBudget;
export const assertCanStartBrowser = assertBudget;
export const assertCanStartComputer = assertBudget;

/** Running sessions stop once the budget, including their unreported time, is spent. */
async function isBudgetSpent(userId: string, pendingUsd: number) {
  try {
    const budget = await resolveBudget(userId);
    if (!budget.metered) return false;
    if (!budget.linked) return true;
    return budget.usage.usedUsd + pendingUsd >= budget.usage.limitUsd;
  } catch (error) {
    // Do not cut a live session off because Deni AI is briefly unreachable.
    console.error("deni ai budget check", error);
    return false;
  }
}

export function isBrowserLimitReached(userId: string, pendingMs = 0) {
  return isBudgetSpent(userId, browserCostUsd(pendingMs));
}

export function isComputerLimitReached(userId: string, pendingMs = 0) {
  return isBudgetSpent(userId, computerCostUsd(pendingMs));
}

export async function assertCanCreateTeammate(userId: string) {
  const store = await readStore(userId);
  const budget = await resolveBudget(userId).catch((): Budget => ({ metered: true, linked: false }));
  const tier = tierOf(budget);
  const limit = TIER_TEAMMATES[tier];
  if (store.bots.length >= limit) {
    throw new UsageLimitError(
      "teammates",
      `Teammate limit reached (${limit} on ${TIER_NAMES[tier]}). Upgrade your Deni AI plan to add more teammates.`,
    );
  }
}

/** Report incurred cost. Failures are logged; undelivered cost is retried with the next report. */
async function recordCost(userId: string, metric: DeniRunCostMetric, costUsd: number) {
  if (!(costUsd > 0) || !deniAiUsageConfigured()) return;
  try {
    const deniUserId = await getLinkedDeniAiUserId(userId);
    if (!deniUserId) return;
    await reportDeniRunCost(deniUserId, metric, costUsd);
  } catch (error) {
    console.error(`report deni run ${metric} cost`, error);
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
  const usage = (result.providerMetadata as { openrouter?: { usage?: OpenRouterUsage } } | undefined)?.openrouter
    ?.usage;
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
