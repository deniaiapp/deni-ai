import "server-only";

import { mutateStore, readStore } from "./store";
import type { Billing, Store, UsagePeriod } from "./types";
import { PLANS, UsageLimitError, isUsageLimitError, type PlanId } from "./plans";

export { UsageLimitError, isUsageLimitError };

const INACTIVE_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired", "incomplete"]);

export function currentUsageMonth(at = new Date()) {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function emptyBilling(): Billing {
  return {
    plan: "free",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeStatus: null,
    currentPeriodEnd: null,
  };
}

export function emptyUsage(month = currentUsageMonth()): UsagePeriod {
  return { month, tokens: 0, browserMs: 0, computerMs: 0 };
}

export function tokensFromUsage(usage?: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
}) {
  if (!usage) return 0;
  if (typeof usage.totalTokens === "number" && usage.totalTokens > 0) return usage.totalTokens;
  return Math.max(0, (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
}

function minutesFromMs(ms: number) {
  return Math.round((ms / 60_000) * 10) / 10;
}

export function effectivePlan(store: Store): PlanId {
  const billing = store.billing ?? emptyBilling();
  if (billing.plan !== "pro") return "free";
  if (billing.stripeStatus && INACTIVE_STATUSES.has(billing.stripeStatus)) return "free";
  return "pro";
}

function ensureUsage(store: Store) {
  store.billing ??= emptyBilling();
  const month = currentUsageMonth();
  if (!store.usage || store.usage.month !== month) {
    store.usage = emptyUsage(month);
  }
  store.usage.tokens ??= 0;
  return store.usage;
}

export function usageSnapshot(
  store: Store,
  live?: { pendingBrowserMs?: number; pendingComputerMs?: number },
) {
  const planId = effectivePlan(store);
  const plan = PLANS[planId];
  const usage =
    store.usage && store.usage.month === currentUsageMonth() ? store.usage : emptyUsage();
  return {
    plan: planId,
    planName: plan.name,
    period: usage.month,
    currentPeriodEnd: store.billing?.currentPeriodEnd ?? null,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO),
    tokens: { used: usage.tokens, limit: plan.tokens },
    browserMinutes: {
      used: minutesFromMs(usage.browserMs + (live?.pendingBrowserMs ?? 0)),
      limit: plan.browserMinutes,
    },
    computerMinutes: {
      used: minutesFromMs(usage.computerMs + (live?.pendingComputerMs ?? 0)),
      limit: plan.computerMinutes,
    },
    teammates: { used: store.bots.length, limit: plan.teammates },
  };
}

export async function getUsageSnapshot(userId: string) {
  const store = await readStore(userId);
  return usageSnapshot(store);
}

export async function consumeUsage(
  userId: string,
  amount: { tokens?: number; browserMs?: number; computerMs?: number },
  opts?: { allowOver?: boolean },
) {
  return mutateStore(userId, (store) => {
    const plan = PLANS[effectivePlan(store)];
    const usage = ensureUsage(store);
    if (amount.tokens) {
      if (!opts?.allowOver && usage.tokens >= plan.tokens) {
        throw new UsageLimitError(
          "tokens",
          `Monthly token limit reached (${plan.tokens.toLocaleString()} on ${plan.name}). Upgrade to keep chatting.`,
        );
      }
      usage.tokens += amount.tokens;
    }
    if (amount.browserMs) {
      const cap = plan.browserMinutes * 60_000;
      if (!opts?.allowOver && usage.browserMs >= cap) {
        throw new UsageLimitError(
          "browser",
          `Monthly browser time limit reached (${plan.browserMinutes} min on ${plan.name}). Upgrade to keep using the browser.`,
        );
      }
      usage.browserMs += amount.browserMs;
    }
    if (amount.computerMs) {
      const cap = plan.computerMinutes * 60_000;
      if (!opts?.allowOver && usage.computerMs >= cap) {
        throw new UsageLimitError(
          "computer",
          `Monthly computer time limit reached (${plan.computerMinutes} min on ${plan.name}). Upgrade to keep using the terminal.`,
        );
      }
      usage.computerMs += amount.computerMs;
    }
    return usageSnapshot(store);
  });
}

export async function assertCanUseTokens(userId: string) {
  const store = await readStore(userId);
  const plan = PLANS[effectivePlan(store)];
  const usage =
    store.usage && store.usage.month === currentUsageMonth() ? store.usage : emptyUsage();
  if (usage.tokens >= plan.tokens) {
    throw new UsageLimitError(
      "tokens",
      `Monthly token limit reached (${plan.tokens.toLocaleString()} on ${plan.name}). Upgrade to keep chatting.`,
    );
  }
}

export async function recordTokenUsage(
  userId: string,
  usage?: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    totalTokens?: number | undefined;
  },
) {
  const tokens = tokensFromUsage(usage);
  if (tokens <= 0) return;
  await consumeUsage(userId, { tokens }, { allowOver: true });
}

export async function assertCanStartBrowser(userId: string) {
  const store = await readStore(userId);
  const plan = PLANS[effectivePlan(store)];
  const usage =
    store.usage && store.usage.month === currentUsageMonth() ? store.usage : emptyUsage();
  if (usage.browserMs >= plan.browserMinutes * 60_000) {
    throw new UsageLimitError(
      "browser",
      `Monthly browser time limit reached (${plan.browserMinutes} min on ${plan.name}). Upgrade to keep using the browser.`,
    );
  }
}

export async function assertCanStartComputer(userId: string) {
  const store = await readStore(userId);
  const plan = PLANS[effectivePlan(store)];
  const usage =
    store.usage && store.usage.month === currentUsageMonth() ? store.usage : emptyUsage();
  if (usage.computerMs >= plan.computerMinutes * 60_000) {
    throw new UsageLimitError(
      "computer",
      `Monthly computer time limit reached (${plan.computerMinutes} min on ${plan.name}). Upgrade to keep using the terminal.`,
    );
  }
}

export async function assertCanCreateTeammate(userId: string) {
  const store = await readStore(userId);
  const plan = PLANS[effectivePlan(store)];
  if (store.bots.length >= plan.teammates) {
    throw new UsageLimitError(
      "teammates",
      `Teammate limit reached (${plan.teammates} on ${plan.name}). Upgrade to add more teammates.`,
    );
  }
}

export function usageLimitPayload(error: UsageLimitError) {
  return {
    error: error.message,
    code: error.code,
    metric: error.metric,
  };
}

export function remainingBrowserMs(store: Store) {
  const plan = PLANS[effectivePlan(store)];
  const usage =
    store.usage && store.usage.month === currentUsageMonth() ? store.usage : emptyUsage();
  return Math.max(0, plan.browserMinutes * 60_000 - usage.browserMs);
}

export function remainingComputerMs(store: Store) {
  const plan = PLANS[effectivePlan(store)];
  const usage =
    store.usage && store.usage.month === currentUsageMonth() ? store.usage : emptyUsage();
  return Math.max(0, plan.computerMinutes * 60_000 - usage.computerMs);
}

export async function isBrowserLimitReached(userId: string, pendingMs = 0) {
  const store = await readStore(userId);
  return remainingBrowserMs(store) - pendingMs <= 0;
}

export async function isComputerLimitReached(userId: string, pendingMs = 0) {
  const store = await readStore(userId);
  return remainingComputerMs(store) - pendingMs <= 0;
}

export type { UsageSnapshot } from "./plans";
