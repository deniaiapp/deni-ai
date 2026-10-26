/**
 * Deni Run has no plans of its own: a user's Deni AI subscription sets one monthly
 * usage pool (priced in USD) shared by Deni AI chat, Flixa, and Deni Run. Deni AI
 * keeps the ledger; Deni Run spends the pool with its model, browser, and computer cost.
 */
export const DENI_TIERS = ["free", "plus", "pro", "max"] as const;
export type DeniTier = (typeof DENI_TIERS)[number];

export const TIER_NAMES: Record<DeniTier, string> = {
  free: "Free",
  plus: "Plus",
  pro: "Pro",
  max: "Max",
};

/** Mirrors USAGE_POOL_USD in Deni AI (src/lib/usage-pool.ts); Deni AI is authoritative. */
export const TIER_BUDGET_USD: Record<DeniTier, number> = {
  free: 10,
  plus: 100,
  pro: 200,
  max: 300,
};

export const TIER_TEAMMATES: Record<DeniTier, number> = {
  free: 5,
  plus: 15,
  pro: 25,
  max: 50,
};

export function isDeniTier(value: unknown): value is DeniTier {
  return typeof value === "string" && (DENI_TIERS as readonly string[]).includes(value);
}

/** `link`: the user has not connected a Deni AI account. `budget`: the monthly pool is spent. */
export type UsageMetric = "budget" | "teammates" | "link";

export class UsageLimitError extends Error {
  code = "usage_limit" as const;
  metric: UsageMetric;
  constructor(metric: UsageMetric, message: string) {
    super(message);
    this.name = "UsageLimitError";
    this.metric = metric;
  }
}

export function isUsageLimitError(error: unknown): error is UsageLimitError {
  return error instanceof UsageLimitError || (error as { code?: string } | null | undefined)?.code === "usage_limit";
}

/** Names the limit on a chat 402 so the client can offer to connect or upgrade instead of failing. */
export const USAGE_LIMIT_HEADER = "x-usage-limit";

export function isUsageMetric(value: unknown): value is UsageMetric {
  return value === "budget" || value === "teammates" || value === "link";
}

export type UsageMeter = { used: number; limit: number };

export type UsageSnapshot = {
  /** False when no Deni AI account is connected; usage is then blocked. */
  linked: boolean;
  /** False on a development deployment without the Deni AI integration: nothing is metered. */
  metered: boolean;
  plan: DeniTier;
  planName: string;
  /** UTC month, e.g. "2026-10". */
  period: string;
  /** When the monthly pool resets (ISO). */
  periodEnd: string | null;
  /**
   * Share of the shared monthly pool used, in percent (no amounts are shown), by
   * product: Deni AI chat, Flixa, and Deni Run (including live browser and computer
   * time not yet reported). Usage is not split by model class.
   */
  pool: { usedPercent: number; parts: { chat: number; flixa: number; run: number } };
  teammates: UsageMeter;
  /** Deni AI page where the plan is managed. */
  manageUrl: string;
};

export function formatUsd(value: number) {
  return `$${value.toFixed(value >= 100 ? 0 : 2)}`;
}

export function formatTokenCount(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const n = abs / 1_000_000;
    return `${value < 0 ? "-" : ""}${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}M`;
  }
  if (abs >= 1_000) {
    const n = abs / 1_000;
    return `${value < 0 ? "-" : ""}${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}k`;
  }
  return String(value);
}
